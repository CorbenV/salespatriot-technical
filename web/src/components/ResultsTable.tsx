import { useEffect, useRef } from 'react';
import type { Solicitation, SortKey } from '../api';
import { fmtDate, fmtNumber } from '../format';
import { DEFAULT_FILTERS, type Filters } from '../useFilters';
import { matchLabel } from '../catalogImport';
import { DaysLeft, Tag } from './bits';
import { DocIcon, ExternalIcon, SortIcon } from './icons';

export const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  returnBy: 'asc',
  posted: 'desc',
  qty: 'desc',
  solicitation: 'asc',
  nomenclature: 'asc',
};

interface Props {
  items: Solicitation[] | undefined;
  loading: boolean;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  selected: string | null;
  activeIndex: number;
  onOpen: (sol: string, index: number) => void;
  empty: React.ReactNode;
}

export function ResultsTable({ items, loading, filters, setFilters, selected, activeIndex, onOpen, empty }: Props) {
  const activeRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const sortDir = filters.dir || DEFAULT_DIR[filters.sort];
  // Each header cycles: its natural direction -> the opposite -> back to the default sort.
  const sortBy = (key: SortKey) => {
    if (filters.sort !== key) {
      setFilters({ sort: key, dir: '' });
    } else if (sortDir === DEFAULT_DIR[key]) {
      setFilters({ dir: DEFAULT_DIR[key] === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilters({ sort: DEFAULT_FILTERS.sort, dir: '' });
    }
  };
  const header = (key: SortKey | null, label: string, className = '') => {
    const active = key !== null && filters.sort === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={`sticky top-0 z-(--z-sticky) border-b border-line bg-canvas/95 px-3 py-2 text-left text-xs font-medium text-ink-3 backdrop-blur-sm ${className}`}
      >
        {key ? (
          <button
            type="button"
            onClick={() => sortBy(key)}
            className={`-mx-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:text-ink ${active ? 'text-ink' : ''}`}
          >
            {label}
            <SortIcon size={13} dir={active ? sortDir : null} />
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <>
      <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {header('returnBy', 'Due', 'w-24 pl-5')}
            {header('nomenclature', 'Item')}
            {header('solicitation', 'Solicitation', 'hidden w-48 @2xl:table-cell')}
            {header('qty', 'Quantity', 'w-24 text-right @xl:w-28 [&>button]:flex-row-reverse')}
            {header(null, 'Set-aside', 'hidden w-32 @5xl:table-cell')}
            {header('posted', 'Posted', 'hidden w-20 @3xl:table-cell')}
            <th
              scope="col"
              className="sticky top-0 z-(--z-sticky) hidden w-20 border-b border-line bg-canvas/95 pr-5 backdrop-blur-sm @xl:table-cell"
            >
              <span className="sr-only">Links</span>
            </th>
          </tr>
        </thead>
        <tbody className={loading && items ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {!items && loading && <SkeletonRows />}
          {items?.map((s, i) => {
            const isSelected = s.solicitation === selected;
            const isActive = i === activeIndex;
            return (
              <tr
                key={s.solicitation}
                ref={isActive ? activeRow : undefined}
                onClick={() => onOpen(s.solicitation, i)}
                aria-selected={isSelected}
                className={`group cursor-pointer align-top transition-colors ${
                  isSelected ? 'bg-ochre-soft' : isActive ? 'bg-hover' : 'hover:bg-hover'
                } ${isActive ? 'outline-2 -outline-offset-2 outline-ochre-strong/70' : ''}`}
              >
                <td className="border-b border-line py-2.5 pr-3 pl-5">
                  <DaysLeft days={s.daysLeft} date={s.returnBy} />
                </td>
                <td className="border-b border-line px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(s.solicitation, i);
                      }}
                      className="block min-w-0 text-left font-medium text-ink @2xl:truncate"
                      title={s.nomenclature}
                    >
                      {s.nomenclature}
                    </button>
                    {s.matches.length > 0 && (
                      <Tag
                        tone="positive"
                        className="max-w-48 shrink-0 truncate"
                        title={`In your catalog: ${s.matches.map(matchLabel).join(' · ')}`}
                      >
                        {matchLabel(s.matches[0]!)}
                        {s.matches.length > 1 && ` +${s.matches.length - 1}`}
                      </Tag>
                    )}
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-ink-3">
                    <span className="mono shrink-0 text-ink-2">{s.nsnDisplay}</span>
                    {s.itemType === 'part' && <Tag title="Part-number item, no NSN assigned">P/N</Tag>}
                    {s.nsnCount > 1 && <span className="shrink-0">+{s.nsnCount - 1} NSN</span>}
                    <span className="mono shrink-0 text-ink-2 @2xl:hidden">{s.solicitationDisplay}</span>
                    {s.fscName && (
                      <span className="truncate" title={`FSC ${s.fsc} · ${s.fscName}`}>
                        {s.fscName}
                      </span>
                    )}
                  </div>
                </td>
                <td className="hidden border-b border-line px-3 py-2.5 @2xl:table-cell">
                  <div className="mono whitespace-nowrap text-ink">{s.solicitationDisplay}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.solType === 'F' && (
                      <Tag title="Fast Award candidate: quotes can be awarded before the return-by date. Quote early.">
                        Fast Award
                      </Tag>
                    )}
                    {s.solType === 'P' && (
                      <Tag title="Auto-evaluated: DIBBS can award before the return-by date. Quote early.">
                        Auto-eval
                      </Tag>
                    )}
                    {s.solType === 'I' && <Tag title="Automated Indefinite Delivery Contract">AIDC</Tag>}
                    {s.prevReturnBy && (
                      <Tag
                        title={`Re-posted with return-by moved from ${fmtDate(s.prevReturnBy)} to ${fmtDate(s.returnBy)}`}
                      >
                        {s.prevReturnBy < s.returnBy ? 'Extended' : 'Moved earlier'}
                      </Tag>
                    )}
                  </div>
                </td>
                <td className="border-b border-line px-3 py-2.5 text-right whitespace-nowrap">
                  <div className="tnum text-ink">
                    {fmtNumber(s.totalQty)} <span className="text-ink-3">{s.unit}</span>
                  </div>
                  {s.lineCount > 1 && <div className="tnum mt-0.5 text-xs text-ink-3">{s.lineCount} lines</div>}
                </td>
                <td className="hidden border-b border-line px-3 py-2.5 @5xl:table-cell">
                  {s.setAside === 'N' ? <span className="text-ink-3">Unrestricted</span> : <Tag>{s.setAsideLabel}</Tag>}
                </td>
                <td className="tnum hidden border-b border-line px-3 py-2.5 whitespace-nowrap text-ink-2 @3xl:table-cell">
                  {fmtDate(s.firstPosted)}
                </td>
                <td className="hidden border-b border-line py-2 pr-5 pl-1 @xl:table-cell">
                  <div className="flex justify-end gap-0.5">
                    <RowLink href={s.links.packageView} label={`Open ${s.solicitationDisplay} on DIBBS`}>
                      <ExternalIcon />
                    </RowLink>
                    <RowLink href={s.links.pdf} label={`Solicitation PDF for ${s.solicitationDisplay}`}>
                      <DocIcon />
                    </RowLink>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {items?.length === 0 && empty}
    </>
  );
}

function RowLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded text-ink-3 transition-colors hover:bg-canvas hover:text-ink hover:shadow-[0_0_0_1px_var(--color-line-strong)]"
    >
      {children}
    </a>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 12 }, (_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="border-b border-line py-3 pr-3 pl-5">
            <Bone className="h-3.5 w-12" />
            <Bone className="mt-1.5 h-3 w-9" />
          </td>
          <td className="border-b border-line px-3 py-3">
            <Bone className="h-3.5" style={{ width: `${40 + ((i * 37) % 40)}%` }} />
            <Bone className="mt-1.5 h-3 w-40" />
          </td>
          <td className="hidden border-b border-line px-3 py-3 @2xl:table-cell">
            <Bone className="h-3.5 w-32" />
          </td>
          <td className="border-b border-line px-3 py-3">
            <Bone className="ml-auto h-3.5 w-14" />
          </td>
          <td className="hidden border-b border-line px-3 py-3 @5xl:table-cell">
            <Bone className="h-3.5 w-20" />
          </td>
          <td className="hidden border-b border-line px-3 py-3 @3xl:table-cell">
            <Bone className="h-3.5 w-10" />
          </td>
          <td className="hidden border-b border-line pr-5 @xl:table-cell" />
        </tr>
      ))}
    </>
  );
}

function Bone({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded bg-line motion-safe:animate-[skeleton_1.4s_ease-in-out_infinite] ${className}`}
      style={style}
    />
  );
}
