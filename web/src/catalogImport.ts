import type { CatalogKind, CatalogMatch } from './api';

export type KindChoice = CatalogKind | 'auto';

export const KIND_LABELS: Record<CatalogKind, { one: string; many: string }> = {
  nsn: { one: 'NSN', many: 'NSNs' },
  part: { one: 'Part number', many: 'Part numbers' },
  fsc: { one: 'FSC', many: 'FSCs' },
  cage: { one: 'CAGE', many: 'CAGE codes' },
  keyword: { one: 'Keyword', many: 'Keywords' },
};

/** Short, row-sized explanation of why an RFQ matched. */
export function matchLabel(m: CatalogMatch): string {
  switch (m.kind) {
    case 'nsn':
      return m.value.length === 9 ? `Your NIIN ${m.value}` : 'Your NSN';
    case 'part':
      return `Your P/N ${m.value}`;
    case 'cage':
      return `CAGE ${m.value}`;
    case 'fsc':
      return `Your FSC ${m.value}`;
    case 'keyword':
      return `“${m.value}”`;
  }
}

/** Mirrors the API's normalizeEntry so the preview can flag invalid entries before upload. */
export function isValid(kind: CatalogKind, raw: string): boolean {
  const t = raw.trim();
  switch (kind) {
    case 'nsn': {
      if (/[a-z]/i.test(t)) return false;
      const d = t.replace(/\D/g, '');
      return d.length === 13 || d.length === 9;
    }
    case 'fsc':
      return /^\d{4}$/.test(t);
    case 'cage':
      return t.replace(/[^a-z0-9]/gi, '').length === 5;
    case 'part':
      return t.replace(/[^a-z0-9]/gi, '').length >= 3;
    case 'keyword':
      return t.replace(/[^a-z0-9]+/gi, ' ').trim().length >= 3;
  }
}

/** Best guess for a single value. CAGE vs part number is ambiguous, so CAGEs are only
 *  detected when a whole batch looks like CAGEs (see detectAll). */
export function detectKind(value: string): CatalogKind {
  const t = value.trim();
  const compact = t.replace(/[\s-]/g, '');
  if (/^\d+$/.test(compact)) {
    if (compact.length === 13 || compact.length === 9) return 'nsn';
    if (compact.length === 4) return 'fsc';
    return 'part';
  }
  if (!/\d/.test(t)) return 'keyword';
  return 'part';
}

const looksLikeCage = (v: string) => /^[a-z0-9]{5}$/i.test(v.trim()) && /\d/.test(v);

export function detectAll(values: string[], choice: KindChoice): CatalogMatch[] {
  if (choice !== 'auto') return values.map((value) => ({ kind: choice, value }));
  const allCages = values.length > 0 && values.every(looksLikeCage);
  return values.map((value) => ({ kind: allCages ? 'cage' : detectKind(value), value }));
}

/** Split pasted text: one entry per line or comma; a line of space-separated codes is a list too. */
export function splitEntries(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[\r\n,;\t]+/)) {
    const t = chunk.trim();
    if (!t) continue;
    const words = t.split(/\s+/);
    if (words.length > 1 && words.every((w) => /\d/.test(w))) out.push(...words);
    else out.push(t);
  }
  return [...new Set(out)];
}

// Header names vendors' ERP / spreadsheet exports tend to use. Checked in order.
const HEADER_KINDS: [RegExp, CatalogKind][] = [
  [/^(nsn|niin|national stock|stock ?(no|num|number|#))/i, 'nsn'],
  [/cage/i, 'cage'],
  [/^(fsc|federal supply)/i, 'fsc'],
  [/(part|p\/n|^pn$|^mpn$|mfr|manufacturer|^sku$)/i, 'part'],
  [/^keywords?$/i, 'keyword'],
];

export interface FileParse {
  entries: CatalogMatch[];
  /** How columns were interpreted, for the preview ("NSN ← 'Stock Number'"). */
  columns: { header: string; kind: CatalogKind }[];
}

/**
 * Parse a CSV/TSV/TXT export. With recognizable headers, only those columns are used.
 * Without, code-like columns are auto-detected and free-text columns (descriptions,
 * prices) are skipped so they don't become junk keywords.
 */
export function parseFile(text: string, choice: KindChoice): FileParse {
  const delimiter = detectDelimiter(text);
  const rows = parseDelimited(text, delimiter).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return { entries: [], columns: [] };

  if (rows[0]!.length === 1 && delimiter === ',') {
    const values = splitEntries(rows.map((r) => r[0]).join('\n'));
    return { entries: detectAll(values, choice), columns: [] };
  }

  const header = rows[0]!;
  const mapped = header
    .map((h, i) => ({ i, header: h.trim(), kind: HEADER_KINDS.find(([re]) => re.test(h.trim()))?.[1] }))
    .filter((c): c is { i: number; header: string; kind: CatalogKind } => !!c.kind);

  const entries: CatalogMatch[] = [];
  if (mapped.length) {
    for (const row of rows.slice(1)) {
      for (const c of mapped) {
        const v = row[c.i]?.trim();
        if (v) entries.push({ kind: choice === 'auto' ? c.kind : choice, value: v });
      }
    }
    return { entries: dedupe(entries), columns: mapped.map(({ header, kind }) => ({ header, kind })) };
  }

  // No usable header: keep columns whose values mostly look like identifiers.
  const width = Math.max(...rows.map((r) => r.length));
  const columns: { header: string; kind: CatalogKind }[] = [];
  for (let i = 0; i < width; i++) {
    const values = rows.map((r) => r[i]?.trim() ?? '').filter(Boolean);
    const detected = detectAll(values, choice);
    const codes = detected.filter((d) => d.kind !== 'keyword').length;
    if (choice === 'auto' && codes < values.length * 0.8) continue;
    entries.push(...detected);
    columns.push({ header: `Column ${i + 1}`, kind: mostCommon(detected.map((d) => d.kind)) });
  }
  return { entries: dedupe(entries), columns };
}

function dedupe(entries: CatalogMatch[]) {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = `${e.kind}|${e.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function mostCommon<T>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]![0];
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', '\t', ';'].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts[0]![0] : ',';
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** One column per type, with headers parseFile recognizes, so an export re-imports cleanly. */
export function toCsv(items: { kind: CatalogKind; value: string }[]): string {
  const cols: CatalogKind[] = ['nsn', 'part', 'fsc', 'cage', 'keyword'];
  const header = ['NSN', 'Part Number', 'FSC', 'CAGE', 'Keyword'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = items.map((i) => cols.map((c) => (c === i.kind ? esc(i.value) : '')).join(','));
  return [header.join(','), ...rows].join('\n');
}
