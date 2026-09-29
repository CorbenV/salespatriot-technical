import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG_SCHEMA } from './catalog.js';
import { FSC_NAMES } from './data/fsc.js';
import type { ApprovedSource, BatchQuoteLine, IndexLine } from './dibbs/parse.js';
import { fscOf } from './dibbs/parse.js';

export type DB = Database.Database;

const SCHEMA = `
-- Source of truth: one row per solicitation line (solicitation + purchase request),
-- upserted from each day's "in" file. Later files win (amendments re-post lines).
CREATE TABLE IF NOT EXISTS lines (
  solicitation     TEXT NOT NULL,
  purchase_request TEXT NOT NULL,
  line_no          TEXT,
  nsn              TEXT NOT NULL,
  item_type        TEXT NOT NULL,
  fsc              TEXT,
  nomenclature     TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  unit             TEXT NOT NULL,
  return_by        TEXT NOT NULL,
  buyer_code       TEXT,
  amsc             TEXT,
  set_aside        TEXT NOT NULL,
  set_aside_pct    INTEGER,
  sol_type         TEXT,
  posted_date      TEXT NOT NULL,
  first_posted     TEXT NOT NULL,
  prev_return_by   TEXT,
  times_posted     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (solicitation, purchase_request)
);
CREATE INDEX IF NOT EXISTS lines_nsn ON lines(nsn);

CREATE TABLE IF NOT EXISTS approved_sources (
  nsn         TEXT NOT NULL,
  cage        TEXT NOT NULL,
  part_number TEXT NOT NULL,
  company     TEXT,
  PRIMARY KEY (nsn, cage, part_number)
);

CREATE TABLE IF NOT EXISTS files (
  post_date   TEXT PRIMARY KEY,
  ingested_at TEXT NOT NULL,
  line_count  INTEGER NOT NULL,
  has_bq      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fsc_names (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Read model: one row per solicitation, rebuilt after every ingest.
-- Multi-line solicitations are almost always the same NSN split across purchase requests.
CREATE TABLE IF NOT EXISTS solicitations (
  solicitation    TEXT PRIMARY KEY,
  nsn             TEXT NOT NULL,
  nsn_count       INTEGER NOT NULL,
  item_type       TEXT NOT NULL,
  fsc             TEXT,
  nomenclature    TEXT NOT NULL,
  total_qty       INTEGER NOT NULL,
  unit            TEXT NOT NULL,
  line_count      INTEGER NOT NULL,
  return_by       TEXT NOT NULL,
  set_aside       TEXT NOT NULL,
  set_aside_pct   INTEGER,
  sol_type        TEXT,
  buyer_code      TEXT,
  posted_date     TEXT NOT NULL,
  first_posted    TEXT NOT NULL,
  prev_return_by  TEXT,
  times_posted    INTEGER NOT NULL,
  source_count    INTEGER NOT NULL,
  cages           TEXT NOT NULL,   -- '|CAGE1|CAGE2|' for exact CAGE filtering
  search_words    TEXT NOT NULL,   -- lowercased nomenclature + FSC name
  search_codes    TEXT NOT NULL    -- lowercased alphanumeric identifiers (sol, NSN, PRs, CAGEs, P/Ns)
);
CREATE INDEX IF NOT EXISTS sol_return_by ON solicitations(return_by);
CREATE INDEX IF NOT EXISTS sol_first_posted ON solicitations(first_posted);
CREATE INDEX IF NOT EXISTS sol_fsc ON solicitations(fsc);
CREATE INDEX IF NOT EXISTS sol_set_aside ON solicitations(set_aside);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.function('alnum', { deterministic: true }, (s: unknown) =>
    String(s ?? '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase(),
  );
  // Lowercase words separated by single spaces; used to match catalog keywords regardless of punctuation.
  db.function('words', { deterministic: true }, (s: unknown) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim(),
  );
  db.exec(SCHEMA);
  db.exec(CATALOG_SCHEMA);
  const insertFsc = db.prepare('INSERT OR REPLACE INTO fsc_names (code, name) VALUES (?, ?)');
  db.transaction(() => {
    for (const [code, name] of Object.entries(FSC_NAMES)) insertFsc.run(code, name);
  })();
  return db;
}

export function ingestedPostDates(db: DB): Set<string> {
  const rows = db.prepare('SELECT post_date FROM files').all() as { post_date: string }[];
  return new Set(rows.map((r) => r.post_date));
}

/**
 * Upsert one day's file. `postDate` is ISO. Safe to apply out of order: newer
 * post dates overwrite, older ones only extend first_posted.
 */
export function ingestDay(
  db: DB,
  postDate: string,
  lines: IndexLine[],
  bq: BatchQuoteLine[] | null,
  sources: ApprovedSource[] | null,
): void {
  const bqByKey = new Map<string, BatchQuoteLine>();
  for (const b of bq ?? []) {
    const key = `${b.solicitation}|${b.purchaseRequest}`;
    if (!bqByKey.has(key)) bqByKey.set(key, b);
  }

  const upsert = db.prepare(`
    INSERT INTO lines (solicitation, purchase_request, line_no, nsn, item_type, fsc, nomenclature,
      quantity, unit, return_by, buyer_code, amsc, set_aside, set_aside_pct, sol_type,
      posted_date, first_posted)
    VALUES (@solicitation, @purchaseRequest, @lineNo, @nsn, @itemType, @fsc, @nomenclature,
      @quantity, @unit, @returnBy, @buyerCode, @amsc, @setAside, @setAsidePct, @solType,
      @postDate, @postDate)
    ON CONFLICT (solicitation, purchase_request) DO UPDATE SET
      prev_return_by = CASE WHEN excluded.posted_date > lines.posted_date AND excluded.return_by <> lines.return_by
                            THEN lines.return_by ELSE lines.prev_return_by END,
      line_no      = CASE WHEN excluded.posted_date > lines.posted_date THEN coalesce(excluded.line_no, lines.line_no) ELSE lines.line_no END,
      nsn          = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.nsn ELSE lines.nsn END,
      item_type    = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.item_type ELSE lines.item_type END,
      fsc          = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.fsc ELSE lines.fsc END,
      nomenclature = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.nomenclature ELSE lines.nomenclature END,
      quantity     = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.quantity ELSE lines.quantity END,
      unit         = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.unit ELSE lines.unit END,
      return_by    = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.return_by ELSE lines.return_by END,
      buyer_code   = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.buyer_code ELSE lines.buyer_code END,
      amsc         = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.amsc ELSE lines.amsc END,
      set_aside    = CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.set_aside ELSE lines.set_aside END,
      set_aside_pct= CASE WHEN excluded.posted_date > lines.posted_date THEN excluded.set_aside_pct ELSE lines.set_aside_pct END,
      sol_type     = CASE WHEN excluded.posted_date > lines.posted_date THEN coalesce(excluded.sol_type, lines.sol_type) ELSE coalesce(lines.sol_type, excluded.sol_type) END,
      posted_date  = max(lines.posted_date, excluded.posted_date),
      first_posted = min(lines.first_posted, excluded.first_posted),
      times_posted = lines.times_posted + 1
  `);
  const deleteSources = db.prepare('DELETE FROM approved_sources WHERE nsn = ?');
  const insertSource = db.prepare(
    'INSERT OR REPLACE INTO approved_sources (nsn, cage, part_number, company) VALUES (?, ?, ?, ?)',
  );
  const recordFile = db.prepare(
    'INSERT OR REPLACE INTO files (post_date, ingested_at, line_count, has_bq) VALUES (?, ?, ?, ?)',
  );

  db.transaction(() => {
    for (const l of lines) {
      const b = bqByKey.get(`${l.solicitation}|${l.purchaseRequest}`);
      upsert.run({
        ...l,
        fsc: fscOf(l.nsn, l.itemType),
        lineNo: b?.lineNo ?? null,
        solType: bq ? (b?.solType ?? null) : null,
        postDate,
      });
    }
    if (sources) {
      const byNsn = new Map<string, ApprovedSource[]>();
      for (const s of sources) byNsn.set(s.nsn, [...(byNsn.get(s.nsn) ?? []), s]);
      for (const [nsn, list] of byNsn) {
        deleteSources.run(nsn);
        for (const s of list) insertSource.run(s.nsn, s.cage, s.partNumber, s.company || null);
      }
    }
    recordFile.run(postDate, new Date().toISOString(), lines.length, bq ? 1 : 0);
  })();
}

export function rebuildSolicitations(db: DB): number {
  db.transaction(() => {
    db.exec('DELETE FROM solicitations');
    db.exec(`
      WITH src AS (
        SELECT DISTINCT l.solicitation, a.cage, a.part_number
        FROM (SELECT DISTINCT solicitation, nsn FROM lines) l
        JOIN approved_sources a ON a.nsn = l.nsn
      ),
      src_agg AS (
        SELECT solicitation,
               COUNT(DISTINCT cage) AS source_count,
               group_concat(lower(cage) || '|' || alnum(part_number), '|') AS codes
        FROM src GROUP BY solicitation
      ),
      cage_agg AS (
        SELECT solicitation, '|' || group_concat(cage, '|') || '|' AS cages
        FROM (SELECT DISTINCT solicitation, cage FROM src) GROUP BY solicitation
      ),
      sol AS (
        SELECT solicitation,
               MIN(nsn) AS nsn, COUNT(DISTINCT nsn) AS nsn_count, MIN(item_type) AS item_type,
               MIN(fsc) AS fsc, MIN(nomenclature) AS nomenclature,
               SUM(quantity) AS total_qty, MIN(unit) AS unit, COUNT(*) AS line_count,
               MAX(return_by) AS return_by, MIN(set_aside) AS set_aside, MAX(set_aside_pct) AS set_aside_pct,
               MIN(sol_type) AS sol_type, MIN(buyer_code) AS buyer_code,
               MAX(posted_date) AS posted_date, MIN(first_posted) AS first_posted,
               MAX(prev_return_by) AS prev_return_by, MAX(times_posted) AS times_posted,
               group_concat(alnum(nsn) || '|' || purchase_request, '|') AS line_codes
        FROM lines GROUP BY solicitation
      )
      INSERT INTO solicitations
      SELECT s.solicitation, s.nsn, s.nsn_count, s.item_type, s.fsc, s.nomenclature, s.total_qty,
             s.unit, s.line_count, s.return_by, s.set_aside, s.set_aside_pct, s.sol_type, s.buyer_code,
             s.posted_date, s.first_posted, s.prev_return_by, s.times_posted,
             coalesce(sa.source_count, 0),
             coalesce(ca.cages, ''),
             lower(s.nomenclature || ' ' || coalesce(f.name, '')),
             '|' || lower(s.solicitation) || '|' || s.line_codes || '|' || coalesce(sa.codes, '') || '|'
      FROM sol s
      LEFT JOIN src_agg sa ON sa.solicitation = s.solicitation
      LEFT JOIN cage_agg ca ON ca.solicitation = s.solicitation
      LEFT JOIN fsc_names f ON f.code = s.fsc
    `);
  })();
  return (db.prepare('SELECT COUNT(*) AS n FROM solicitations').get() as { n: number }).n;
}
