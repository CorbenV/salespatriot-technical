import type { Meta } from '../api';
import type { View } from '../useFilters';
import { fmtDate, fmtTime } from '../format';
import { RefreshIcon } from './icons';

export function TopBar({
  meta,
  onRefresh,
  view,
  onView,
  catalogSize,
}: {
  meta: Meta | undefined;
  onRefresh: () => void;
  view: View;
  onView: (v: View) => void;
  catalogSize: number;
}) {
  const tab = (v: View, label: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onView(v)}
      aria-current={view === v ? 'page' : undefined}
      className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
        view === v ? 'bg-hover font-medium text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
  const running = meta?.ingest.running ?? false;
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-canvas px-5">
      <div className="flex items-center gap-2.5">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="7" className="fill-ink" />
          <path d="M9 10h14M9 16h10M9 22h6" stroke="var(--color-ochre)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className="text-[15px] font-semibold tracking-tight">RFQ Desk</span>
        <nav aria-label="Sections" className="ml-3 flex items-center gap-1">
          {tab('rfqs', 'RFQs')}
          {tab(
            'catalog',
            <>
              My catalog
              {catalogSize > 0 && (
                <span className="tnum ml-1.5 text-xs text-ink-3">{catalogSize.toLocaleString()}</span>
              )}
            </>,
          )}
        </nav>
      </div>

      <div className="flex items-center gap-3 text-xs text-ink-3">
        {meta?.ingest.lastError && !running && (
          <span className="text-urgent" title={meta.ingest.lastError}>
            Last update failed
          </span>
        )}
        {meta?.latestPostDate && (
          <span className="hidden md:inline" title={`${meta.fileCount} daily files since ${meta.earliestPostDate}`}>
            Files through <span className="font-medium text-ink-2">{fmtDate(meta.latestPostDate)}</span>
            {meta.ingest.lastSuccessAt && <> · checked {fmtTime(meta.ingest.lastSuccessAt)}</>}
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:cursor-progress disabled:opacity-70"
        >
          <RefreshIcon size={13} className={running ? 'motion-safe:animate-spin' : ''} />
          {running ? 'Checking DIBBS…' : 'Check for new files'}
        </button>
      </div>
    </header>
  );
}
