import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { ActiveFilters } from './components/ActiveFilters';
import { CatalogView } from './components/CatalogView';
import { Kbd } from './components/bits';
import { DetailDrawer } from './components/DetailDrawer';
import { FilterPanel } from './components/FilterPanel';
import { CloseIcon, FilterIcon, SearchIcon } from './components/icons';
import { Pagination } from './components/Pagination';
import { ResultsTable } from './components/ResultsTable';
import { TopBar } from './components/TopBar';
import { fmtNumber, pluralize } from './format';
import { countActive, toApiParams, useUrlState } from './useFilters';

const STATUS_NOUN = {
  open: 'open solicitations',
  closing: 'closing within 3 days',
  closed: 'past their return-by date',
  all: 'solicitations',
} as const;

export default function App() {
  const { filters, setFilters, reset, pivot, selected, setSelected, view, setView } = useUrlState();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const meta = useQuery({
    queryKey: ['meta'],
    queryFn: api.meta,
    refetchInterval: (q) => (q.state.data?.ingest.running || q.state.data?.fileCount === 0 ? 3000 : 300_000),
  });
  const running = meta.data?.ingest.running ?? false;
  const empty = meta.data?.fileCount === 0;

  // When an ingest finishes, results may have changed.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void queryClient.invalidateQueries({ queryKey: ['solicitations'] });
    wasRunning.current = running;
  }, [running, queryClient]);

  const refresh = useMutation({
    mutationFn: api.refresh,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['meta'] }),
  });

  const params = toApiParams(filters).toString();
  const list = useQuery({
    queryKey: ['solicitations', params],
    queryFn: ({ signal }) => api.list(new URLSearchParams(params), signal),
    placeholderData: keepPreviousData,
    enabled: !empty,
  });
  const items = list.data?.items;

  useEffect(() => setActiveIndex(-1), [params]);

  // Search: local draft, debounced into the URL state.
  const [q, setQ] = useState(filters.q);
  useEffect(() => setQ(filters.q), [filters.q]);
  useEffect(() => {
    if (q === filters.q) return;
    const t = setTimeout(() => setFilters({ q }), 220);
    return () => clearTimeout(t);
  }, [q, filters.q, setFilters]);

  const open = (sol: string, index: number) => {
    setSelected(sol);
    setActiveIndex(index);
  };

  // Keyboard: "/" search, j/k or arrows move, Enter opens, Esc closes.
  useEffect(() => {
    if (view !== 'rfqs') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.matches('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape') {
        if (typing) target.blur();
        else if (filtersOpen) setFiltersOpen(false);
        else if (selected) setSelected(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || !items?.length) {
        if (e.key === '/' && !typing) {
          e.preventDefault();
          searchRef.current?.focus();
        }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(items.length - 1, activeIndex + 1);
        setActiveIndex(next);
        if (selected) setSelected(items[next]!.solicitation);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.max(0, activeIndex - 1);
        setActiveIndex(next);
        if (selected) setSelected(items[next]!.solicitation);
      } else if (e.key === 'Enter' && activeIndex >= 0 && target === document.body) {
        setSelected(items[activeIndex]!.solicitation);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, activeIndex, selected, setSelected, filtersOpen, view]);

  const activeFilters = countActive(filters);
  const total = list.data?.total ?? 0;
  const preview = items?.find((s) => s.solicitation === selected);

  const catalogSize = list.data?.facets.mine.catalogSize ?? 0;
  const openCatalog = () => {
    setSelected(null);
    setFiltersOpen(false);
    setView('catalog');
  };
  // Pivots from the catalog page land back on the RFQ list.
  const pivotToRfqs = (patch: Parameters<typeof pivot>[0]) => {
    pivot(patch);
    setView('rfqs');
  };

  const panel = (
    <FilterPanel
      filters={filters}
      facets={list.data?.facets}
      setFilters={setFilters}
      reset={reset}
      onOpenCatalog={openCatalog}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        meta={meta.data}
        onRefresh={() => refresh.mutate()}
        view={view}
        onView={setView}
        catalogSize={catalogSize}
      />
      {(list.isFetching || running) && (
        <div className="relative h-0.5 shrink-0 overflow-hidden" role="progressbar" aria-label="Loading">
          <div className="absolute inset-y-0 w-1/4 bg-ochre motion-safe:animate-[indeterminate_1.1s_var(--ease-out-quart)_infinite]" />
        </div>
      )}

      {view === 'catalog' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CatalogView onPivot={pivotToRfqs} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="Filters"
            className="hidden w-72 shrink-0 overflow-y-auto border-r border-line bg-panel lg:block"
          >
            {panel}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-5 pt-4 pb-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon
                    size={16}
                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3"
                  />
                  <input
                    ref={searchRef}
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onPaste={(e) => {
                      // Single-line inputs drop newlines; keep pasted lists (one NSN per line) as a list.
                      const text = e.clipboardData.getData('text');
                      if (!/[\r\n]/.test(text)) return;
                      e.preventDefault();
                      const list = text
                        .split(/[\r\n]+/)
                        .map((v) => v.trim())
                        .filter(Boolean)
                        .join(', ');
                      const el = e.currentTarget;
                      const next =
                        el.value.slice(0, el.selectionStart ?? el.value.length) +
                        list +
                        el.value.slice(el.selectionEnd ?? el.value.length);
                      setQ(next);
                    }}
                    placeholder="Search items, NSNs, solicitation #s, CAGEs or part numbers. Paste a list or try 5962*"
                    title="Commas separate alternatives. A list of NSNs or codes matches any of them. * is a wildcard: 5962* finds FSC 5962."
                    aria-label="Search solicitations"
                    spellCheck={false}
                    className="w-full rounded-lg border border-line-strong bg-canvas py-2 pr-10 pl-9 text-sm placeholder:text-ink-3 hover:border-ink-3 focus:border-ink focus:outline-none"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block">
                    <Kbd>/</Kbd>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] font-medium text-ink lg:hidden"
                >
                  <FilterIcon size={15} />
                  Filters
                  {activeFilters > 0 && (
                    <span className="tnum rounded-full bg-ink px-1.5 text-[11px] text-canvas">{activeFilters}</span>
                  )}
                </button>
              </div>
              <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1.5">
                <p className="text-[13px] text-ink-2" aria-live="polite">
                  {list.data ? (
                    <>
                      <span className="tnum font-semibold text-ink">{fmtNumber(total)}</span>{' '}
                      {STATUS_NOUN[filters.status]}
                      {filters.q && (
                        <>
                          {' '}
                          matching “<span className="text-ink">{filters.q}</span>”
                        </>
                      )}
                    </>
                  ) : (
                    ' '
                  )}
                </p>
                <ActiveFilters filters={filters} facets={list.data?.facets} setFilters={setFilters} />
              </div>
            </div>

            <div className="@container min-h-0 flex-1 overflow-auto">
              {empty ? (
                <FirstRun
                  running={running}
                  error={meta.data?.ingest.lastError ?? null}
                  onRetry={() => refresh.mutate()}
                />
              ) : list.isError && !list.data ? (
                <Notice
                  title="Can't reach the RFQ service"
                  body="The API didn't respond. It may still be starting up."
                  action={{ label: 'Try again', onClick: () => void list.refetch() }}
                />
              ) : (
                <ResultsTable
                  items={items}
                  loading={list.isFetching}
                  filters={filters}
                  setFilters={setFilters}
                  selected={selected}
                  activeIndex={activeIndex}
                  onOpen={open}
                  empty={
                    <EmptyResults
                      hasQuery={!!filters.q}
                      hasFilters={activeFilters > 0}
                      status={filters.status}
                      onClearQuery={() => setFilters({ q: '' })}
                      onClearFilters={reset}
                      onIncludeClosed={() => setFilters({ status: 'all' })}
                    />
                  }
                />
              )}
            </div>

            {!empty && list.data && total > 0 && (
              <Pagination
                page={filters.page}
                pageSize={filters.pageSize}
                total={total}
                onPage={(page) => setFilters({ page })}
                onPageSize={(pageSize) => setFilters({ pageSize })}
              />
            )}
          </main>

          {selected && (
            <DetailDrawer
              key={selected}
              sol={selected}
              preview={preview}
              onClose={() => setSelected(null)}
              onPivot={pivot}
            />
          )}
        </div>
      )}

      {filtersOpen && (
        <div className="fixed inset-0 z-(--z-drawer) lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setFiltersOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(22rem,100%)] flex-col bg-panel shadow-xl motion-safe:animate-[drawer-in_200ms_var(--ease-out-quart)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-semibold">Filters</span>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close filters"
                className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{panel}</div>
            <div className="border-t border-line p-3">
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="w-full rounded-md bg-ink py-2 text-[13px] font-medium text-canvas"
              >
                Show {pluralize(total, 'result')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyResults(props: {
  hasQuery: boolean;
  hasFilters: boolean;
  status: string;
  onClearQuery: () => void;
  onClearFilters: () => void;
  onIncludeClosed: () => void;
}) {
  const actions = [
    props.hasQuery && { label: 'Clear search', onClick: props.onClearQuery },
    props.hasFilters && { label: 'Clear filters', onClick: props.onClearFilters },
    props.status !== 'all' && { label: 'Include past-due RFQs', onClick: props.onIncludeClosed },
  ].filter(Boolean) as { label: string; onClick: () => void }[];
  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <p className="font-medium text-ink">No solicitations match</p>
      <p className="mt-1 text-[13px] text-ink-3">
        Search looks at nomenclature, product class names, NSNs, solicitation and PR numbers, and approved-source CAGEs
        and part numbers. Separate alternatives with commas and use * as a wildcard (5962* for a whole product class).
        Dashes in numbers are ignored.
      </p>
      {actions.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-medium text-ink hover:bg-hover"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mx-auto max-w-md px-5 py-16 text-center">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-[13px] text-ink-3">{body}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-canvas hover:bg-ink/85"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function FirstRun({ running, error, onRetry }: { running: boolean; error: string | null; onRetry: () => void }) {
  if (!running && error)
    return (
      <Notice
        title="Couldn't download from DIBBS"
        body={`${error}. DIBBS is sometimes slow or down for maintenance; try again in a minute.`}
        action={{ label: 'Try again', onClick: onRetry }}
      />
    );
  return (
    <Notice
      title="Pulling the daily RFQ files from DIBBS"
      body="The first load downloads about a month of daily index files. This usually takes under a minute; results appear automatically."
    />
  );
}
