import { z } from 'zod';
import type { DB } from './db.js';
import { formatNsn } from './dibbs/parse.js';

/**
 * The vendor's catalog: what they sell or make. Solicitations are matched against it
 * in bulk (catalog_matches) so "only my RFQs" is a cheap filter and every match can
 * explain itself.
 */
export const CATALOG_KINDS = ['nsn', 'part', 'fsc', 'cage', 'keyword'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CATALOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS catalog (
  kind     TEXT NOT NULL,
  norm     TEXT NOT NULL,   -- normalized value used for matching
  value    TEXT NOT NULL,   -- display value
  added_at TEXT NOT NULL,
  PRIMARY KEY (kind, norm)
);
CREATE TABLE IF NOT EXISTS catalog_matches (
  solicitation TEXT NOT NULL,
  kind         TEXT NOT NULL,
  norm         TEXT NOT NULL,
  PRIMARY KEY (solicitation, kind, norm)
);
CREATE INDEX IF NOT EXISTS catalog_matches_item ON catalog_matches(kind, norm);
`;

export const addCatalogSchema = z.object({
  mode: z.enum(['append', 'replace']).default('append'),
  items: z.array(z.object({ kind: z.enum(CATALOG_KINDS), value: z.string().max(200) })).max(50_000),
});

/** Normalize a raw entry for its kind, or null if it isn't a valid value of that kind. */
export function normalizeEntry(kind: CatalogKind, raw: string): { norm: string; value: string } | null {
  const trimmed = raw.trim();
  switch (kind) {
    case 'nsn': {
      if (/[a-z]/i.test(trimmed)) return null;
      const digits = trimmed.replace(/\D/g, '');
      if (digits.length === 13) return { norm: digits, value: formatNsn(digits) };
      if (digits.length === 9) return { norm: digits, value: digits }; // NIIN: any FSC
      return null;
    }
    case 'fsc': {
      const digits = trimmed.replace(/\D/g, '');
      return digits.length === 4 && /^\d{4}$/.test(trimmed) ? { norm: digits, value: digits } : null;
    }
    case 'cage': {
      const cage = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return cage.length === 5 ? { norm: cage, value: cage } : null;
    }
    case 'part': {
      const norm = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');
      return norm.length >= 3 ? { norm, value: trimmed.toUpperCase() } : null;
    }
    case 'keyword': {
      const norm = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      return norm.length >= 3 ? { norm, value: norm } : null;
    }
  }
}

export function addCatalogItems(db: DB, input: z.infer<typeof addCatalogSchema>) {
  const now = new Date().toISOString();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO catalog (kind, norm, value, added_at) VALUES (@kind, @norm, @value, @now)',
  );
  let added = 0;
  const invalid: { kind: CatalogKind; value: string }[] = [];
  db.transaction(() => {
    if (input.mode === 'replace') db.exec('DELETE FROM catalog');
    for (const item of input.items) {
      const n = normalizeEntry(item.kind, item.value);
      if (!n) {
        if (item.value.trim()) invalid.push(item);
        continue;
      }
      added += insert.run({ kind: item.kind, ...n, now }).changes;
    }
  })();
  rebuildCatalogMatches(db);
  return { added, duplicates: input.items.length - added - invalid.length, invalid: invalid.slice(0, 200) };
}

export function removeCatalogItem(db: DB, kind: string, norm: string) {
  const { changes } = db.prepare('DELETE FROM catalog WHERE kind = ? AND norm = ?').run(kind, norm);
  db.prepare('DELETE FROM catalog_matches WHERE kind = ? AND norm = ?').run(kind, norm);
  return changes > 0;
}

export function clearCatalog(db: DB) {
  db.exec('DELETE FROM catalog; DELETE FROM catalog_matches;');
}

/** Recompute every solicitation <-> catalog match. Run after catalog edits and ingests. */
export function rebuildCatalogMatches(db: DB) {
  db.transaction(() => {
    db.exec('DELETE FROM catalog_matches');
    // Normalize once into indexed temp tables; joining on alnum()/words() directly would
    // call back into JS for every (row x catalog item) pair.
    db.exec(`
      DROP TABLE IF EXISTS temp.ap_norm;
      CREATE TEMP TABLE ap_norm AS SELECT nsn, cage, alnum(part_number) AS part FROM approved_sources;
      CREATE INDEX temp.ap_norm_part ON ap_norm(part);
      CREATE INDEX temp.ap_norm_cage ON ap_norm(cage);

      DROP TABLE IF EXISTS temp.part_items;
      CREATE TEMP TABLE part_items AS
        SELECT DISTINCT solicitation, substr(alnum(nsn), 6) AS part FROM lines WHERE item_type = 'part';
      CREATE INDEX temp.part_items_part ON part_items(part);

      DROP TABLE IF EXISTS temp.sol_words;
      CREATE TEMP TABLE sol_words AS SELECT solicitation, words(nomenclature) AS w FROM solicitations;
    `);
    db.exec(`
      -- Exact NSN
      INSERT OR IGNORE INTO catalog_matches
      SELECT DISTINCT l.solicitation, 'nsn', c.norm
      FROM catalog c JOIN lines l ON l.nsn = c.norm
      WHERE c.kind = 'nsn' AND length(c.norm) = 13;

      -- NIIN (last 9 digits of the NSN, any FSC)
      INSERT OR IGNORE INTO catalog_matches
      SELECT DISTINCT l.solicitation, 'nsn', c.norm
      FROM lines l JOIN catalog c ON c.kind = 'nsn' AND c.norm = substr(l.nsn, 5)
      WHERE l.item_type = 'nsn' AND length(l.nsn) = 13;

      -- Product class
      INSERT OR IGNORE INTO catalog_matches
      SELECT DISTINCT l.solicitation, 'fsc', c.norm
      FROM catalog c JOIN lines l ON l.fsc = c.norm
      WHERE c.kind = 'fsc';

      -- CAGE listed as an approved source for the item
      INSERT OR IGNORE INTO catalog_matches
      SELECT DISTINCT l.solicitation, 'cage', c.norm
      FROM catalog c
      JOIN ap_norm a ON a.cage = c.norm
      JOIN lines l ON l.nsn = a.nsn
      WHERE c.kind = 'cage';

      -- Part number: an approved-source part number...
      INSERT OR IGNORE INTO catalog_matches
      SELECT DISTINCT l.solicitation, 'part', c.norm
      FROM catalog c
      JOIN ap_norm a ON a.part = c.norm
      JOIN lines l ON l.nsn = a.nsn
      WHERE c.kind = 'part';

      -- ...or the item itself for part-number buys (field is CAGE + part number)
      INSERT OR IGNORE INTO catalog_matches
      SELECT DISTINCT p.solicitation, 'part', c.norm
      FROM catalog c JOIN part_items p ON p.part = c.norm
      WHERE c.kind = 'part';

      -- Keyword in the item name (product classes are covered by FSC entries)
      INSERT OR IGNORE INTO catalog_matches
      SELECT w.solicitation, 'keyword', c.norm
      FROM catalog c JOIN sol_words w ON w.w LIKE '%' || c.norm || '%'
      WHERE c.kind = 'keyword';

      DROP TABLE temp.ap_norm;
      DROP TABLE temp.part_items;
      DROP TABLE temp.sol_words;
    `);
  })();
}

export function listCatalog(db: DB, today: string) {
  const items = db
    .prepare(
      `SELECT c.kind, c.norm, c.value, c.added_at,
              COUNT(DISTINCT CASE WHEN s.return_by >= @today THEN s.solicitation END) AS open_matches,
              COUNT(DISTINCT s.solicitation) AS all_matches
       FROM catalog c
       LEFT JOIN catalog_matches m ON m.kind = c.kind AND m.norm = c.norm
       LEFT JOIN solicitations s ON s.solicitation = m.solicitation
       GROUP BY c.kind, c.norm
       ORDER BY open_matches DESC, c.kind, c.value`,
    )
    .all({ today }) as {
    kind: CatalogKind;
    norm: string;
    value: string;
    added_at: string;
    open_matches: number;
    all_matches: number;
  }[];
  const totals = db
    .prepare(
      `SELECT COUNT(DISTINCT m.solicitation) AS all_matches,
              COUNT(DISTINCT CASE WHEN s.return_by >= ? THEN m.solicitation END) AS open_matches
       FROM catalog_matches m JOIN solicitations s ON s.solicitation = m.solicitation`,
    )
    .get(today) as { all_matches: number; open_matches: number };
  return {
    items: items.map((i) => ({
      kind: i.kind,
      norm: i.norm,
      value: i.value,
      addedAt: i.added_at,
      openMatches: i.open_matches,
      allMatches: i.all_matches,
    })),
    totals: { items: items.length, openMatches: totals.open_matches, allMatches: totals.all_matches },
  };
}

const REASON_ORDER: Record<string, number> = { nsn: 0, part: 1, cage: 2, fsc: 3, keyword: 4 };

/** Why each of these solicitations matched the catalog, most specific reason first. */
export function matchReasons(db: DB, sols: string[]) {
  const out = new Map<string, { kind: CatalogKind; value: string }[]>();
  if (!sols.length) return out;
  const rows = db
    .prepare(
      `SELECT m.solicitation, m.kind, c.value FROM catalog_matches m
       JOIN catalog c ON c.kind = m.kind AND c.norm = m.norm
       WHERE m.solicitation IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(sols)) as { solicitation: string; kind: CatalogKind; value: string }[];
  for (const r of rows) out.set(r.solicitation, [...(out.get(r.solicitation) ?? []), { kind: r.kind, value: r.value }]);
  for (const list of out.values())
    list.sort((a, b) => REASON_ORDER[a.kind]! - REASON_ORDER[b.kind]! || b.value.length - a.value.length);
  return out;
}
