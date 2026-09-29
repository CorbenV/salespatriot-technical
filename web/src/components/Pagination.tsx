import { fmtNumber } from '../format';
import { ChevronIcon } from './icons';

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn =
    'inline-flex size-7 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-40';
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-t border-line px-5 text-xs text-ink-3">
      <label className="flex items-center gap-1.5">
        Rows
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="tnum rounded-md border border-line bg-canvas px-1.5 py-1 text-xs text-ink hover:border-line-strong"
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <span className="tnum">
          {fmtNumber(from)}–{fmtNumber(to)} of {fmtNumber(total)}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className={btn}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronIcon size={14} className="rotate-180" />
          </button>
          <button
            type="button"
            className={btn}
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
