import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, type Solicitation } from '../api';
import { fmtDate, fmtDaysLeft, fmtLongDate, fmtNumber, urgency } from '../format';
import { CopyButton } from './bits';
import { matchLabel } from '../catalogImport';
import type { Filters } from '../useFilters';
import { CheckIcon, ChevronIcon, CloseIcon, DocIcon, ExternalIcon, QuoteIcon } from './icons';

interface Props {
  sol: string;
  preview: Solicitation | undefined;
  onClose: () => void;
  /** Replace the current search with a related one (same NSN, FSC or CAGE). */
  onPivot: (patch: Partial<Filters>) => void;
}

const pivotLink = 'rounded underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink';
const secondaryButton =
  'inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-hover';

export function DetailDrawer({ sol, preview, onClose, onPivot }: Props) {
  const { data, isError, refetch } = useQuery({
    queryKey: ['solicitation', sol],
    queryFn: ({ signal }) => api.detail(sol, signal),
  });
  const s = data ?? preview;
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [sol]);

  return (
    <aside
      aria-label="Solicitation details"
      className="fixed inset-y-0 right-0 z-(--z-drawer) flex w-full flex-col border-l border-line bg-canvas shadow-[-12px_0_32px_-16px_oklch(0.24_0.016_258/0.18)] motion-safe:animate-[drawer-in_220ms_var(--ease-out-quart)] sm:w-[30rem] 2xl:static 2xl:z-auto 2xl:h-full 2xl:w-[30rem] 2xl:shrink-0 2xl:shadow-none"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <span className="mono truncate text-ink">{s?.solicitationDisplay ?? sol}</span>
          <CopyButton value={s?.solicitationDisplay ?? sol} label="solicitation number" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          title="Close (Esc)"
          className="inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto">
        {!s && !isError && <p className="px-5 py-6 text-ink-3">Loading…</p>}
        {isError && !s && (
          <div className="px-5 py-6">
            <p className="text-ink">Couldn't load this solicitation.</p>
            <button type="button" onClick={() => refetch()} className="mt-2 font-medium underline underline-offset-4">
              Try again
            </button>
          </div>
        )}
        {s && (
          <>
            <header className="px-5 pt-5 pb-4">
              <h2 className="text-lg leading-snug font-semibold text-balance text-ink">{s.nomenclature}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
                <span className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => onPivot({ q: s.nsn, status: 'all' })}
                    className={`mono ${pivotLink}`}
                    title={`Show every RFQ for ${s.nsnDisplay}`}
                  >
                    {s.nsnDisplay}
                  </button>
                  <CopyButton value={s.nsnDisplay} label={s.itemType === 'part' ? 'part number' : 'NSN'} />
                </span>
                {s.fsc && (
                  <button
                    type="button"
                    onClick={() => onPivot({ fsc: [s.fsc!] })}
                    className={`text-left text-ink-3 ${pivotLink}`}
                    title={`Show open RFQs in FSC ${s.fsc}`}
                  >
                    FSC {s.fsc}
                    {s.fscName ? ` · ${s.fscName}` : ''}
                  </button>
                )}
              </div>
              {s.matches.length > 0 && (
                <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-positive">
                  <CheckIcon size={15} />
                  <span className="font-medium">In your catalog:</span>
                  {s.matches.map((m) => (
                    <span key={`${m.kind}-${m.value}`} className="text-ink-2">
                      {matchLabel(m)}
                    </span>
                  ))}
                </p>
              )}
              {data && data.otherNsnRfqs > 0 && (
                <button
                  type="button"
                  onClick={() => onPivot({ q: s.nsn, status: 'all' })}
                  className="mt-2 inline-flex items-center gap-0.5 text-[13px] font-medium text-ink hover:underline hover:underline-offset-4"
                >
                  DLA has {data.otherNsnRfqs} other {data.otherNsnRfqs === 1 ? 'RFQ' : 'RFQs'} for this item
                  <ChevronIcon size={14} />
                </button>
              )}

              {s.daysLeft < 0 ? (
                <p className="mt-4 rounded-md border border-line-strong bg-panel px-3 py-2 text-[13px] leading-snug text-ink-2">
                  <span className="font-semibold text-ink">The return-by date has passed.</span> DIBBS sometimes keeps
                  auto-evaluated RFQs open past it, so check the status on DIBBS before writing it off.
                </p>
              ) : (
                (s.solType === 'F' || s.solType === 'P') && (
                  <p className="mt-4 rounded-md border border-ochre/50 bg-ochre-soft px-3 py-2 text-[13px] leading-snug text-ochre-ink">
                    <span className="font-semibold">Quote early.</span>{' '}
                    {s.solType === 'F'
                      ? 'Fast Award candidate: micro-purchase quotes can be awarded before the return-by date.'
                      : 'Auto-evaluated: DIBBS can award as quotes come in, before the return-by date.'}
                  </p>
                )
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={s.links.quote}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-canvas transition-colors hover:bg-ink/85"
                >
                  <QuoteIcon size={15} />
                  Quote on DIBBS
                </a>
                <a href={s.links.packageView} target="_blank" rel="noreferrer" className={secondaryButton}>
                  <ExternalIcon size={15} />
                  View on DIBBS
                </a>
                <a href={s.links.pdf} target="_blank" rel="noreferrer" className={secondaryButton}>
                  <DocIcon size={15} />
                  PDF
                </a>
              </div>
              <p className="mt-2 text-xs text-ink-3">
                Quoting needs your DIBBS login. DIBBS shows a DoD notice once per visit.
              </p>
            </header>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-5 py-4 text-[13px]">
              <Fact label="Return by">
                <span className="font-medium">{fmtLongDate(s.returnBy)}</span>
                <span
                  className={`ml-1.5 ${
                    urgency(s.daysLeft) === 'urgent'
                      ? 'font-semibold text-urgent'
                      : urgency(s.daysLeft) === 'soon'
                        ? 'font-semibold text-ochre-ink'
                        : 'text-ink-3'
                  }`}
                >
                  {s.daysLeft < 0
                    ? 'Past return-by'
                    : s.daysLeft === 0
                      ? 'Due today'
                      : `${fmtDaysLeft(s.daysLeft)} left`}
                </span>
                {s.prevReturnBy && (
                  <div className="mt-0.5 text-xs text-ink-2">
                    {s.prevReturnBy < s.returnBy ? 'Extended' : 'Moved'} from {fmtDate(s.prevReturnBy)}
                  </div>
                )}
              </Fact>
              <Fact label="Total quantity">
                <span className="tnum font-medium">
                  {fmtNumber(s.totalQty)} {s.unit}
                </span>
                {s.lineCount > 1 && <span className="ml-1.5 text-ink-3">over {s.lineCount} lines</span>}
              </Fact>
              <Fact label="Set-aside">
                {s.setAsideLabel}
                {s.setAside !== 'N' && s.setAsidePct ? <span className="text-ink-3"> · {s.setAsidePct}%</span> : null}
              </Fact>
              <Fact label="Type">{s.solTypeLabel ?? 'Unknown'}</Fact>
              <Fact label="First posted">
                {fmtLongDate(s.firstPosted)}
                {s.firstPosted !== s.postedDate && (
                  <div className="mt-0.5 text-xs text-ink-3">Re-posted {fmtDate(s.postedDate)}</div>
                )}
              </Fact>
              <Fact label="Buyer code">
                <span className="mono">{s.buyerCode || '—'}</span>
              </Fact>
            </dl>

            {data && (
              <>
                <section className="border-t border-line px-5 py-4">
                  <h3 className="text-[13px] font-semibold">Approved sources</h3>
                  {data.approvedSources.length === 0 ? (
                    <p className="mt-1 text-[13px] text-ink-3">
                      DIBBS lists no approved sources for this item. Check the solicitation for source requirements.
                    </p>
                  ) : (
                    <>
                      <p className="mt-0.5 mb-2 text-xs text-ink-3">
                        Select a CAGE to see every RFQ it's an approved source for.
                      </p>
                      <ul className="flex flex-col">
                        {data.approvedSources.map((a) => (
                          <li
                            key={`${a.nsn}-${a.cage}-${a.partNumber}`}
                            className="flex items-center gap-3 border-t border-line py-1.5 text-[13px]"
                          >
                            <button
                              type="button"
                              onClick={() => onPivot({ cage: a.cage })}
                              className="mono rounded px-1 font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                              title={`Show RFQs where ${a.cage} is an approved source`}
                            >
                              {a.cage}
                            </button>
                            <span className="mono min-w-0 flex-1 truncate text-ink-2" title={a.partNumber}>
                              {a.partNumber || '—'}
                            </span>
                            {a.company && <span className="truncate text-ink-3">{a.company}</span>}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
                <section className="border-t border-line px-5 py-4">
                  <h3 className="mb-2 text-[13px] font-semibold">
                    {data.lines.length === 1 ? 'Line item' : `${data.lines.length} line items`}
                  </h3>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-xs text-ink-3">
                        <th className="pb-1.5 font-medium">Line</th>
                        <th className="pb-1.5 font-medium">Purchase request</th>
                        {data.nsnCount > 1 && <th className="pb-1.5 font-medium">NSN</th>}
                        <th className="pb-1.5 text-right font-medium">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lines.map((l) => (
                        <tr key={l.purchaseRequest} className="border-t border-line">
                          <td className="tnum py-1.5 text-ink-3">{l.lineNo ? Number(l.lineNo) : '—'}</td>
                          <td className="mono py-1.5">{l.purchaseRequest}</td>
                          {data.nsnCount > 1 && <td className="mono py-1.5">{l.nsnDisplay}</td>}
                          <td className="tnum py-1.5 text-right">
                            {fmtNumber(l.quantity)} <span className="text-ink-3">{l.unit}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}
