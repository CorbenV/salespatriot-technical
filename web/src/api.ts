export type Status = 'open' | 'closing' | 'closed' | 'all';
export type Posted = 'latest' | '3d' | '7d' | 'all';
export type SortKey = 'returnBy' | 'posted' | 'qty' | 'solicitation' | 'nomenclature';
export type SourcesFilter = 'any' | 'with' | 'without';

export interface Solicitation {
  solicitation: string;
  solicitationDisplay: string;
  nsn: string;
  nsnDisplay: string;
  nsnCount: number;
  itemType: 'nsn' | 'part';
  fsc: string | null;
  fscName: string | null;
  nomenclature: string;
  totalQty: number;
  unit: string;
  lineCount: number;
  returnBy: string;
  daysLeft: number;
  setAside: string;
  setAsideLabel: string;
  setAsidePct: number | null;
  solType: string | null;
  solTypeLabel: string | null;
  buyerCode: string | null;
  postedDate: string;
  firstPosted: string;
  prevReturnBy: string | null;
  timesPosted: number;
  sourceCount: number;
  links: { packageView: string; quote: string; pdf: string };
  /** Why this solicitation matches the vendor's catalog (empty if it doesn't). */
  matches: CatalogMatch[];
}

export type CatalogKind = 'nsn' | 'part' | 'fsc' | 'cage' | 'keyword';

export interface CatalogMatch {
  kind: CatalogKind;
  value: string;
}

export interface CatalogItem {
  kind: CatalogKind;
  norm: string;
  value: string;
  addedAt: string;
  openMatches: number;
  allMatches: number;
}

export interface CatalogResponse {
  items: CatalogItem[];
  totals: { items: number; openMatches: number; allMatches: number };
}

export interface CatalogAddResult {
  added: number;
  duplicates: number;
  invalid: CatalogMatch[];
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface ListResponse {
  items: Solicitation[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    mine: { count: number; catalogSize: number };
    status: Record<Status, number>;
    fsc: FacetOption[];
    setAside: FacetOption[];
    solType: FacetOption[];
  };
}

export interface SolicitationDetail extends Solicitation {
  otherNsnRfqs: number;
  lines: {
    lineNo: string | null;
    purchaseRequest: string;
    nsn: string;
    nsnDisplay: string;
    nomenclature: string;
    quantity: number;
    unit: string;
    nsnView: string | null;
  }[];
  approvedSources: { nsn: string; cage: string; partNumber: string; company: string | null }[];
}

export interface Meta {
  today: string;
  fileCount: number;
  earliestPostDate: string | null;
  latestPostDate: string | null;
  totals: { solicitations: number; open: number; latestDrop: number };
  ingest: {
    running: boolean;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    lastAdded: number;
  };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export const api = {
  list: (params: URLSearchParams, signal?: AbortSignal) =>
    getJson<ListResponse>(`/api/solicitations?${params}`, { signal }),
  detail: (sol: string, signal?: AbortSignal) =>
    getJson<SolicitationDetail>(`/api/solicitations/${encodeURIComponent(sol)}`, { signal }),
  meta: () => getJson<Meta>('/api/meta'),
  refresh: () => getJson<{ started: boolean }>('/api/ingest', { method: 'POST' }),
  catalog: () => getJson<CatalogResponse>('/api/catalog'),
  addCatalog: (items: CatalogMatch[], mode: 'append' | 'replace') =>
    getJson<CatalogAddResult>('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, mode }),
    }),
  removeCatalogItem: async (kind: CatalogKind, norm: string) => {
    const res = await fetch(`/api/catalog/${kind}/${encodeURIComponent(norm)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Request failed (${res.status})`);
  },
  clearCatalog: async () => {
    const res = await fetch('/api/catalog', { method: 'DELETE' });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
  },
};
