/**
 * Parsers for the DIBBS daily RFQ download files.
 * Layouts: https://www.dibbs.bsm.dla.mil/Rfq/RfqFileDefs.aspx
 *          https://www.dibbs.bsm.dla.mil/Refs/help/Quoting/Batch/BatchFormat.aspx
 */

export interface IndexLine {
  solicitation: string;
  nsn: string; // 13-digit NSN, or CAGE + part number when itemType === 'part'
  purchaseRequest: string;
  returnBy: string; // ISO yyyy-mm-dd
  quantity: number;
  unit: string;
  nomenclature: string;
  buyerCode: string;
  amsc: string;
  itemType: 'nsn' | 'part';
  setAside: string; // Y H R L A E N
  setAsidePct: number;
}

export interface BatchQuoteLine {
  solicitation: string;
  solType: string; // F P I or blank
  lineNo: string;
  purchaseRequest: string;
}

export interface ApprovedSource {
  nsn: string;
  cage: string;
  partNumber: string;
  company: string;
}

// "in" file: fixed width, 140 chars per record
const INDEX_LAYOUT = [
  ['solicitation', 13],
  ['nsn', 46],
  ['purchaseRequest', 13],
  ['returnBy', 8],
  ['fileName', 19],
  ['quantity', 7],
  ['unit', 2],
  ['nomenclature', 21],
  ['buyerCode', 5],
  ['amsc', 1],
  ['itemType', 1],
  ['setAside', 1],
  ['setAsidePct', 3],
] as const;

export function parseIndexFile(text: string): IndexLine[] {
  const out: IndexLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().length === 0) continue;
    const f: Record<string, string> = {};
    let pos = 0;
    for (const [name, width] of INDEX_LAYOUT) {
      f[name] = raw.slice(pos, pos + width).trim();
      pos += width;
    }
    const returnBy = mmddyyToIso(f.returnBy!);
    if (!f.solicitation || !f.nsn || !returnBy) continue;
    out.push({
      solicitation: f.solicitation,
      nsn: f.nsn,
      purchaseRequest: f.purchaseRequest!,
      returnBy,
      quantity: toInt(f.quantity),
      unit: f.unit!,
      nomenclature: f.nomenclature!,
      buyerCode: f.buyerCode!,
      amsc: f.amsc!,
      itemType: f.itemType === '2' ? 'part' : 'nsn',
      setAside: f.setAside || 'N',
      setAsidePct: toInt(f.setAsidePct),
    });
  }
  return out;
}

// "bq" file: CSV, every field double-quoted. Column numbers per BatchFormat.aspx (1-based).
const BQ = { solicitation: 0, solType: 1, lineNo: 43, purchaseRequest: 45 } as const;

export function parseBatchQuoteFile(text: string): BatchQuoteLine[] {
  return parseCsv(text)
    .filter((r) => r.length > BQ.purchaseRequest && r[BQ.solicitation])
    .map((r) => ({
      solicitation: r[BQ.solicitation]!.trim(),
      solType: r[BQ.solType]!.trim(),
      lineNo: r[BQ.lineNo]!.trim(),
      purchaseRequest: r[BQ.purchaseRequest]!.trim(),
    }));
}

// "as" file: NSN, approved source CAGE, part number, company name
export function parseApprovedSourcesFile(text: string): ApprovedSource[] {
  return parseCsv(text)
    .filter((r) => r.length >= 3 && r[0] && r[1])
    .map((r) => ({
      nsn: r[0]!.trim(),
      cage: r[1]!.trim().toUpperCase(),
      partNumber: (r[2] ?? '').trim(),
      company: (r[3] ?? '').trim(),
    }));
}

/** Small RFC-4180 style CSV parser (quoted fields, "" escapes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function mmddyyToIso(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  return m ? `20${m[3]}-${m[1]}-${m[2]}` : null;
}

function toInt(s: string | undefined): number {
  const n = Number.parseInt(s ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

/** "SPE1C126Q0309" -> "SPE1C1-26-Q-0309" (how DIBBS displays solicitation numbers). */
export function formatSolicitation(sol: string): string {
  return sol.length === 13 ? `${sol.slice(0, 6)}-${sol.slice(6, 8)}-${sol.slice(8, 9)}-${sol.slice(9)}` : sol;
}

/** "8315000750244" -> "8315-00-075-0244". Non-NSN values are returned as-is. */
export function formatNsn(nsn: string): string {
  return /^\d{13}$/.test(nsn) ? `${nsn.slice(0, 4)}-${nsn.slice(4, 6)}-${nsn.slice(6, 9)}-${nsn.slice(9)}` : nsn;
}

/** FSC is the first 4 digits of an NSN; part-number items have none. */
export function fscOf(nsn: string, itemType: 'nsn' | 'part'): string | null {
  return itemType === 'nsn' && /^\d{4}/.test(nsn) ? nsn.slice(0, 4) : null;
}
