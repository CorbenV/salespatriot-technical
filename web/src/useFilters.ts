import { useCallback, useEffect, useState } from 'react';
import type { Posted, SortKey, SourcesFilter, Status } from './api';

export interface Filters {
  q: string;
  status: Status;
  posted: Posted;
  fsc: string[];
  setAside: string[];
  solType: string[];
  qtyMin: string;
  qtyMax: string;
  cage: string;
  sources: SourcesFilter;
  amended: boolean;
  /** Only solicitations matching the vendor's catalog. A scope, not a filter: "clear filters" keeps it. */
  mine: boolean;
  sort: SortKey;
  dir: 'asc' | 'desc' | '';
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: Filters = {
  q: '',
  status: 'open',
  posted: 'all',
  fsc: [],
  setAside: [],
  solType: [],
  qtyMin: '',
  qtyMax: '',
  cage: '',
  sources: 'any',
  amended: false,
  mine: false,
  sort: 'posted',
  dir: '',
  page: 1,
  pageSize: 50,
};

const LIST_KEYS = ['fsc', 'setAside', 'solType'] as const;

function fromUrl(search: string): Filters {
  const p = new URLSearchParams(search);
  const f: Filters = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
    const v = p.get(key);
    if (v === null) continue;
    if ((LIST_KEYS as readonly string[]).includes(key)) (f[key] as string[]) = v.split(',').filter(Boolean);
    else if (key === 'amended' || key === 'mine') f[key] = v === 'true';
    else if (key === 'page' || key === 'pageSize') f[key] = Math.max(1, Number(v) || DEFAULT_FILTERS[key]);
    else (f[key] as string) = v;
  }
  return f;
}

/** Only non-default values, so URLs stay short and shareable. */
export function toParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
    const v = f[key];
    const d = DEFAULT_FILTERS[key];
    if (Array.isArray(v)) {
      if (v.length) p.set(key, v.join(','));
    } else if (v !== d && v !== '') p.set(key, String(v));
  }
  return p;
}

/** Params sent to the API always include status/sort so server defaults can't drift. */
export function toApiParams(f: Filters): URLSearchParams {
  const p = toParams(f);
  p.set('status', f.status);
  p.set('pageSize', String(f.pageSize));
  if (!/^[A-Za-z0-9]{5}$/.test(f.cage)) p.delete('cage');
  return p;
}

export function countActive(f: Filters): number {
  let n = 0;
  if (f.posted !== 'all') n++;
  n += f.fsc.length + f.setAside.length + f.solType.length;
  if (f.qtyMin || f.qtyMax) n++;
  if (f.cage) n++;
  if (f.sources !== 'any') n++;
  if (f.amended) n++;
  return n;
}

export type View = 'rfqs' | 'catalog';

export function useUrlState() {
  const [filters, setFiltersState] = useState<Filters>(() => fromUrl(window.location.search));
  const [selected, setSelectedState] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('sol'),
  );
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get('view') === 'catalog' ? 'catalog' : 'rfqs',
  );

  useEffect(() => {
    const p = toParams(filters);
    if (selected) p.set('sol', selected);
    if (view !== 'rfqs') p.set('view', view);
    const qs = p.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', url);
    }
  }, [filters, selected, view]);

  /** Any change other than paging resets to page 1. */
  const setFilters = useCallback((patch: Partial<Filters>) => {
    setFiltersState((prev) => ({ ...prev, page: 1, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setFiltersState((prev) => ({ ...DEFAULT_FILTERS, q: prev.q, sort: prev.sort, dir: prev.dir, mine: prev.mine }));
  }, []);

  /** Start a fresh, related search (e.g. "every RFQ for this NSN"), keeping sort and page size. */
  const pivot = useCallback((patch: Partial<Filters>) => {
    setFiltersState((prev) => ({
      ...DEFAULT_FILTERS,
      sort: prev.sort,
      dir: prev.dir,
      pageSize: prev.pageSize,
      ...patch,
    }));
  }, []);

  return { filters, setFilters, reset, pivot, selected, setSelected: setSelectedState, view, setView };
}
