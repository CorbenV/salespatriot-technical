import type { ListResponse } from '../api';
import { fmtNumber } from '../format';
import { SET_ASIDE_LABELS, SOL_TYPE_LABELS } from '../labels';
import type { Filters } from '../useFilters';
import { CloseIcon } from './icons';

const POSTED_LABEL = { latest: 'New in latest drop', '3d': 'New in last 3 days', '7d': 'New in last 7 days', all: '' };
const SOURCES_LABEL = { with: 'Approved sources listed', without: 'No approved sources', any: '' };

/** Removable chips for every non-default filter, so the current slice is always legible. */
export function ActiveFilters({
  filters,
  facets,
  setFilters,
}: {
  filters: Filters;
  facets: ListResponse['facets'] | undefined;
  setFilters: (patch: Partial<Filters>) => void;
}) {
  const label = (list: ListResponse['facets']['fsc'] | undefined, v: string, fallback: Record<string, string> = {}) =>
    list?.find((o) => o.value === v)?.label ?? fallback[v] ?? v;

  const chips: { key: string; text: React.ReactNode; remove: () => void }[] = [];
  if (filters.posted !== 'all')
    chips.push({ key: 'posted', text: POSTED_LABEL[filters.posted], remove: () => setFilters({ posted: 'all' }) });
  for (const v of filters.fsc)
    chips.push({
      key: `fsc-${v}`,
      text:
        v === 'none' ? (
          'Part-number items'
        ) : (
          <>
            <span className="mono">{v}</span> {label(facets?.fsc, v)}
          </>
        ),
      remove: () => setFilters({ fsc: filters.fsc.filter((x) => x !== v) }),
    });
  for (const v of filters.setAside)
    chips.push({
      key: `sa-${v}`,
      text: label(facets?.setAside, v, SET_ASIDE_LABELS),
      remove: () => setFilters({ setAside: filters.setAside.filter((x) => x !== v) }),
    });
  for (const v of filters.solType)
    chips.push({
      key: `st-${v}`,
      text: label(facets?.solType, v, SOL_TYPE_LABELS),
      remove: () => setFilters({ solType: filters.solType.filter((x) => x !== v) }),
    });
  if (filters.qtyMin || filters.qtyMax) {
    const min = filters.qtyMin ? fmtNumber(Number(filters.qtyMin)) : '0';
    const text = filters.qtyMax ? `Qty ${min}–${fmtNumber(Number(filters.qtyMax))}` : `Qty ≥ ${min}`;
    chips.push({ key: 'qty', text, remove: () => setFilters({ qtyMin: '', qtyMax: '' }) });
  }
  if (filters.cage)
    chips.push({
      key: 'cage',
      text: (
        <>
          Approved source <span className="mono">{filters.cage}</span>
        </>
      ),
      remove: () => setFilters({ cage: '' }),
    });
  if (filters.sources !== 'any')
    chips.push({ key: 'sources', text: SOURCES_LABEL[filters.sources], remove: () => setFilters({ sources: 'any' }) });
  if (filters.mine) chips.push({ key: 'mine', text: 'In my catalog', remove: () => setFilters({ mine: false }) });
  if (filters.amended)
    chips.push({ key: 'amended', text: 'Deadline changed', remove: () => setFilters({ amended: false }) });

  if (!chips.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Active filters">
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={c.remove}
            className="inline-flex max-w-72 items-center gap-1 rounded-full border border-line-strong bg-canvas py-0.5 pr-1.5 pl-2.5 text-xs text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            <span className="truncate">{c.text}</span>
            <CloseIcon size={12} aria-hidden="true" />
            <span className="sr-only">Remove filter</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
