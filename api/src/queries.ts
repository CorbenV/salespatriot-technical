import { z } from 'zod';
import type { DB } from './db.js';
import { DIBBS, SET_ASIDES, SOL_TYPES } from './dibbs/codes.js';
import { formatNsn, formatSolicitation } from './dibbs/parse.js';

const csv = z
  .string()
  .optional()
  .transform((s) =>
    s
      ? s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      : [],
  );

export const listQuerySchema = z.object({
  q: z.string().trim().max(4000).optional(),
  status: z.enum(['open', 'closing', 'closed', 'all']).default('open'),
  posted: z.enum(['latest', '3d', '7d', 'all']).default('all'),
  fsc: csv,
  setAside: csv,
  solType: csv, // F P I M(anual)
  qtyMin: z.coerce.number().int().min(0).optional(),
  qtyMax: z.coerce.number().int().min(0).optional(),
  cage: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{5}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  sources: z.enum(['any', 'with', 'without']).default('any'),
  amended: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z.enum(['returnBy', 'posted', 'qty', 'solicitation', 'nomenclature']).default('posted'),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

type FacetKey = 'status' | 'fsc' | 'setAside' | 'solType';

const SORT_SQL: Record<ListQuery['sort'], { col: string; dir: 'ASC' | 'DESC' }> = {
  returnBy: { col: 'return_by', dir: 'ASC' },
  posted: { col: 'first_posted', dir: 'DESC' },
  qty: { col: 'total_qty', dir: 'DESC' },
  solicitation: { col: 'solicitation', dir: 'ASC' },
  nomenclature: { col: 'nomenclature', dir: 'ASC' },
};

const CLOSING_SOON_DAYS = 3;

/** Dates on DIBBS are Eastern time. */
export function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function latestPostDate(db: DB): string | null {
  return (db.prepare('SELECT MAX(posted_date) AS d FROM solicitations').get() as { d: string | null }).d;
}

const MAX_ALTERNATIVES = 100;

interface SearchTerm {
  word: string; // matched as a substring of nomenclature / FSC name
  code: string | null; // LIKE pattern against the '|'-delimited identifier column
}

/**
 * Search syntax, modelled on how vendors search DIBBS:
 * - commas, semicolons or newlines separate alternatives (any may match);
 * - a run of identifiers separated by spaces is also a list ("5962011231234 5962011231235");
 * - otherwise words within an alternative must all match ("safety glasses");
 * - `*` is a wildcard; a code ending in `*` is a prefix ("5962*" = everything in FSC 5962).
 * Identifiers ignore punctuation, so dashed NSNs and solicitation numbers work.
 */
export function parseSearch(input: string): SearchTerm[][] {
  const groups: SearchTerm[][] = [];
  for (const chunk of input.toLowerCase().split(/[,;\n\r]+/)) {
    const words = chunk.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const isCode = (w: string) => /\d/.test(w) || w.includes('*');
    const asList = words.length > 1 && words.every(isCode);
    for (const group of asList ? words.map((w) => [w]) : [words]) {
      const terms = group.map(toTerm).filter((t): t is SearchTerm => t !== null);
      if (terms.length) groups.push(terms);
    }
  }
  return groups.slice(0, MAX_ALTERNATIVES);
}

function toTerm(raw: string): SearchTerm | null {
  const word = raw.replace(/\*/g, '').replace(/[%_]/g, '');
  const code = raw.replace(/[^a-z0-9*]/g, '');
  const codeChars = code.replace(/\*/g, '');
  if (!word && !codeChars) return null;
  if (codeChars.length < 2) return { word, code: null };
  // Wildcards anchor at the start of an identifier; plain codes match anywhere inside one.
  const pattern = code.includes('*') ? `%|${code.replace(/\*+/g, '%')}%` : `%${code}%`;
  return { word, code: pattern };
}

function buildWhere(db: DB, q: ListQuery, today: string, omit?: FacetKey) {
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (omit !== 'status') {
    params.today = today;
    if (q.status === 'open') where.push('return_by >= @today');
    else if (q.status === 'closed') where.push('return_by < @today');
    else if (q.status === 'closing') {
      where.push('return_by BETWEEN @today AND @soon');
      params.soon = addDays(today, CLOSING_SOON_DAYS);
    }
  }

  if (q.posted !== 'all') {
    const latest = latestPostDate(db);
    if (latest) {
      const back = q.posted === 'latest' ? 0 : q.posted === '3d' ? 2 : 6;
      // "Posted" means first posted: re-posted amendments are not new opportunities.
      where.push('first_posted >= @postedFrom');
      params.postedFrom = addDays(latest, -back);
    }
  }

  if (q.q) {
    const groups = parseSearch(q.q);
    const alternatives = groups.map((terms, g) =>
      terms
        .map((term, t) => {
          const key = `s${g}_${t}`;
          params[`${key}w`] = `%${term.word}%`;
          if (!term.code) return `search_words LIKE @${key}w`;
          params[`${key}c`] = term.code;
          return `(search_words LIKE @${key}w OR search_codes LIKE @${key}c)`;
        })
        .join(' AND '),
    );
    if (alternatives.length) where.push(`((${alternatives.join(') OR (')}))`);
  }

  const inList = (col: string, key: string, values: string[]) => {
    if (!values.length) return;
    const names = values.map((v, i) => {
      params[`${key}${i}`] = v;
      return `@${key}${i}`;
    });
    where.push(`${col} IN (${names.join(', ')})`);
  };

  if (omit !== 'fsc') {
    const codes = q.fsc.filter((f) => f !== 'none');
    const parts: string[] = [];
    if (codes.length) {
      parts.push(`fsc IN (${codes.map((v, i) => ((params[`fsc${i}`] = v), `@fsc${i}`)).join(', ')})`);
    }
    if (q.fsc.includes('none')) parts.push('fsc IS NULL');
    if (parts.length) where.push(`(${parts.join(' OR ')})`);
  }
  if (omit !== 'setAside') inList('set_aside', 'sa', q.setAside);
  if (omit !== 'solType' && q.solType.length) {
    const mapped = q.solType.map((t) => (t === 'M' ? '' : t));
    inList("coalesce(sol_type, '')", 'st', mapped);
  }

  if (q.qtyMin !== undefined) {
    where.push('total_qty >= @qtyMin');
    params.qtyMin = q.qtyMin;
  }
  if (q.qtyMax !== undefined) {
    where.push('total_qty <= @qtyMax');
    params.qtyMax = q.qtyMax;
  }
  if (q.cage) {
    where.push('cages LIKE @cage');
    params.cage = `%|${q.cage.toUpperCase()}|%`;
  }
  if (q.sources === 'with') where.push('source_count > 0');
  if (q.sources === 'without') where.push('source_count = 0');
  if (q.amended) where.push('prev_return_by IS NOT NULL');

  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

interface SolRow {
  solicitation: string;
  nsn: string;
  nsn_count: number;
  item_type: 'nsn' | 'part';
  fsc: string | null;
  fsc_name: string | null;
  nomenclature: string;
  total_qty: number;
  unit: string;
  line_count: number;
  return_by: string;
  set_aside: string;
  set_aside_pct: number | null;
  sol_type: string | null;
  buyer_code: string | null;
  posted_date: string;
  first_posted: string;
  prev_return_by: string | null;
  times_posted: number;
  source_count: number;
}

function toItem(r: SolRow, today: string) {
  return {
    solicitation: r.solicitation,
    solicitationDisplay: formatSolicitation(r.solicitation),
    nsn: r.nsn,
    nsnDisplay: formatNsn(r.nsn),
    nsnCount: r.nsn_count,
    itemType: r.item_type,
    fsc: r.fsc,
    fscName: r.fsc_name,
    nomenclature: r.nomenclature,
    totalQty: r.total_qty,
    unit: r.unit,
    lineCount: r.line_count,
    returnBy: r.return_by,
    daysLeft: daysBetween(today, r.return_by),
    setAside: r.set_aside,
    setAsideLabel: SET_ASIDES[r.set_aside] ?? r.set_aside,
    setAsidePct: r.set_aside_pct,
    solType: r.sol_type,
    solTypeLabel: r.sol_type === null ? null : (SOL_TYPES[r.sol_type] ?? r.sol_type),
    buyerCode: r.buyer_code,
    postedDate: r.posted_date,
    firstPosted: r.first_posted,
    prevReturnBy: r.prev_return_by,
    timesPosted: r.times_posted,
    sourceCount: r.source_count,
    links: {
      packageView: DIBBS.packageView(r.solicitation),
      quote: DIBBS.quote(r.solicitation),
      pdf: DIBBS.pdf(r.solicitation),
    },
  };
}

const SELECT_COLS = `s.solicitation, s.nsn, s.nsn_count, s.item_type, s.fsc, f.name AS fsc_name, s.nomenclature,
  s.total_qty, s.unit, s.line_count, s.return_by, s.set_aside, s.set_aside_pct, s.sol_type, s.buyer_code,
  s.posted_date, s.first_posted, s.prev_return_by, s.times_posted, s.source_count`;

export function listSolicitations(db: DB, q: ListQuery) {
  const today = todayEt();
  const { sql, params } = buildWhere(db, q, today);
  const sort = SORT_SQL[q.sort];
  const dir = q.dir ? q.dir.toUpperCase() : sort.dir;
  const tiebreak = q.sort === 'returnBy' ? 'first_posted DESC' : 'return_by ASC';

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM solicitations ${sql}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM solicitations s LEFT JOIN fsc_names f ON f.code = s.fsc
       ${sql} ORDER BY ${sort.col} ${dir}, ${tiebreak}, solicitation LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: q.pageSize, offset: (q.page - 1) * q.pageSize }) as SolRow[];

  return {
    items: rows.map((r) => toItem(r, today)),
    total,
    page: q.page,
    pageSize: q.pageSize,
    facets: facets(db, q, today),
  };
}

function facets(db: DB, q: ListQuery, today: string) {
  const count = (omit: FacetKey, select: string, group: string) => {
    const { sql, params } = buildWhere(db, q, today, omit);
    return db.prepare(`SELECT ${select}, COUNT(*) AS n FROM solicitations ${sql} GROUP BY ${group}`).all(params);
  };

  const statusRows = (() => {
    const { sql, params } = buildWhere(db, q, today, 'status');
    return db
      .prepare(
        `SELECT
           SUM(return_by >= @t) AS open,
           SUM(return_by BETWEEN @t AND @soon) AS closing,
           SUM(return_by < @t) AS closed,
           COUNT(*) AS total
         FROM solicitations ${sql}`,
      )
      .get({ ...params, t: today, soon: addDays(today, CLOSING_SOON_DAYS) }) as Record<string, number | null>;
  })();

  const fscRows = count('fsc', 'fsc', 'fsc') as { fsc: string | null; n: number }[];
  const names = new Map(
    (db.prepare('SELECT code, name FROM fsc_names').all() as { code: string; name: string }[]).map((r) => [
      r.code,
      r.name,
    ]),
  );

  return {
    status: {
      open: statusRows.open ?? 0,
      closing: statusRows.closing ?? 0,
      closed: statusRows.closed ?? 0,
      all: statusRows.total ?? 0,
    },
    fsc: fscRows
      .map((r) => ({
        value: r.fsc ?? 'none',
        label: r.fsc ? (names.get(r.fsc) ?? 'Unlisted FSC') : 'Part-number items (no FSC)',
        count: r.n,
      }))
      .sort((a, b) => b.count - a.count),
    setAside: (count('setAside', 'set_aside', 'set_aside') as { set_aside: string; n: number }[])
      .map((r) => ({ value: r.set_aside, label: SET_ASIDES[r.set_aside] ?? r.set_aside, count: r.n }))
      .sort((a, b) => b.count - a.count),
    solType: (count('solType', "coalesce(sol_type, '') AS t", 't') as { t: string; n: number }[])
      .map((r) => ({ value: r.t === '' ? 'M' : r.t, label: SOL_TYPES[r.t] ?? r.t, count: r.n }))
      .sort((a, b) => b.count - a.count),
  };
}

export function getSolicitation(db: DB, sol: string) {
  const row = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM solicitations s LEFT JOIN fsc_names f ON f.code = s.fsc WHERE s.solicitation = ?`,
    )
    .get(sol.toUpperCase()) as SolRow | undefined;
  if (!row) return null;

  const lines = db
    .prepare(
      `SELECT line_no, purchase_request, nsn, item_type, nomenclature, quantity, unit
       FROM lines WHERE solicitation = ? ORDER BY line_no, purchase_request`,
    )
    .all(row.solicitation) as {
    line_no: string | null;
    purchase_request: string;
    nsn: string;
    item_type: string;
    nomenclature: string;
    quantity: number;
    unit: string;
  }[];
  const sources = db
    .prepare(
      `SELECT DISTINCT a.nsn, a.cage, a.part_number, a.company FROM approved_sources a
       WHERE a.nsn IN (SELECT nsn FROM lines WHERE solicitation = ?) ORDER BY a.cage, a.part_number`,
    )
    .all(row.solicitation) as { nsn: string; cage: string; part_number: string; company: string | null }[];

  // "Is DLA buying this part elsewhere?" Other solicitations for any NSN on this one.
  const otherNsnRfqs = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT solicitation) AS n FROM lines
         WHERE nsn IN (SELECT nsn FROM lines WHERE solicitation = ?) AND solicitation <> ?`,
      )
      .get(row.solicitation, row.solicitation) as { n: number }
  ).n;

  return {
    ...toItem(row, todayEt()),
    otherNsnRfqs,
    lines: lines.map((l) => ({
      lineNo: l.line_no,
      purchaseRequest: l.purchase_request,
      nsn: l.nsn,
      nsnDisplay: formatNsn(l.nsn),
      nomenclature: l.nomenclature,
      quantity: l.quantity,
      unit: l.unit,
      nsnView: l.item_type === 'nsn' ? DIBBS.nsnView(l.nsn) : null,
    })),
    approvedSources: sources.map((s) => ({
      nsn: s.nsn,
      cage: s.cage,
      partNumber: s.part_number,
      company: s.company,
    })),
  };
}

export function getMeta(db: DB) {
  const files = db
    .prepare('SELECT COUNT(*) AS n, MIN(post_date) AS earliest, MAX(post_date) AS latest FROM files')
    .get() as { n: number; earliest: string | null; latest: string | null };
  const today = todayEt();
  const totals = db.prepare('SELECT COUNT(*) AS total, SUM(return_by >= ?) AS open FROM solicitations').get(today) as {
    total: number;
    open: number | null;
  };
  const newest = files.latest
    ? (db.prepare('SELECT COUNT(*) AS n FROM solicitations WHERE first_posted = ?').get(files.latest) as { n: number })
        .n
    : 0;
  return {
    today,
    fileCount: files.n,
    earliestPostDate: files.earliest,
    latestPostDate: files.latest,
    totals: { solicitations: totals.total, open: totals.open ?? 0, latestDrop: newest },
  };
}
