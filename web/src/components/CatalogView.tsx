import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { api, type CatalogAddResult, type CatalogItem, type CatalogKind, type CatalogMatch } from '../api';
import {
  detectAll,
  isValid,
  KIND_LABELS,
  type FileParse,
  type KindChoice,
  parseFile,
  splitEntries,
  toCsv,
} from '../catalogImport';
import { fmtNumber, pluralize } from '../format';
import type { Filters } from '../useFilters';
import { ChevronIcon, CloseIcon, DocIcon } from './icons';

const KINDS: CatalogKind[] = ['nsn', 'part', 'fsc', 'cage', 'keyword'];

const KIND_HELP: Record<CatalogKind, string> = {
  nsn: 'Exact item. A 9-digit NIIN matches the item in any FSC.',
  part: 'Approved-source part numbers, and part-number buys with no NSN.',
  fsc: 'Every item in a 4-digit product class, e.g. 5305 Screws.',
  cage: 'RFQs where that company is an approved source: yours, or brands you distribute.',
  keyword: 'Words in the item name, e.g. "o-ring" or "gasket".',
};

const EXAMPLE = '5305\n5310\n5330\no-ring\ngasket';

const button = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-canvas transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-md border border-line-strong bg-canvas px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-hover disabled:opacity-40',
  link: 'font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink',
};

export function CatalogView({ onPivot }: { onPivot: (patch: Partial<Filters>) => void }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: api.catalog });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['solicitations'] });
    void queryClient.invalidateQueries({ queryKey: ['solicitation'] });
  };
  const totals = catalog.data?.totals;

  const exportCsv = () => {
    const blob = new Blob([toCsv(catalog.data?.items ?? [])], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rfq-desk-catalog.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-balance">My catalog</h1>
          <p className="mt-1 max-w-[65ch] text-[13px] text-ink-2">
            Everything you sell or make. RFQs that match any entry are flagged in the list, and switching to{' '}
            <span className="font-medium text-ink">My catalog</span> shows only those.
          </p>
        </div>
        {totals && totals.items > 0 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button.secondary} onClick={exportCsv}>
              <DocIcon size={15} />
              Export CSV
            </button>
            <button type="button" className={button.primary} onClick={() => onPivot({ mine: true })}>
              View {pluralize(totals.openMatches, 'matching open RFQ')}
              <ChevronIcon size={14} />
            </button>
          </div>
        )}
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <AddPanel isEmpty={totals?.items === 0} onAdded={refresh} />
        <CatalogList
          items={catalog.data?.items}
          loading={catalog.isLoading}
          error={catalog.isError}
          onChanged={refresh}
          onPivot={onPivot}
        />
      </div>
    </div>
  );
}

function AddPanel({ isEmpty, onAdded }: { isEmpty: boolean; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<KindChoice>('auto');
  const [file, setFile] = useState<{ name: string; raw: string } | null>(null);
  const [replace, setReplace] = useState(false);
  const [result, setResult] = useState<CatalogAddResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsedFile: FileParse | null = useMemo(() => (file ? parseFile(file.raw, choice) : null), [file, choice]);
  const entries: CatalogMatch[] = useMemo(
    () => [...detectAll(splitEntries(text), choice), ...(parsedFile?.entries ?? [])],
    [text, choice, parsedFile],
  );
  const valid = entries.filter((e) => isValid(e.kind, e.value));
  const invalid = entries.filter((e) => !isValid(e.kind, e.value));
  const byKind = KINDS.map((k) => ({ kind: k, n: valid.filter((e) => e.kind === k).length })).filter((k) => k.n);

  const add = useMutation({
    mutationFn: () => api.addCatalog(valid, replace ? 'replace' : 'append'),
    onSuccess: (res) => {
      setResult(res);
      setText('');
      setFile(null);
      setReplace(false);
      onAdded();
    },
  });

  return (
    <section aria-labelledby="add-heading" className="rounded-lg border border-line bg-panel p-4">
      <h2 id="add-heading" className="text-[15px] font-semibold">
        Add items
      </h2>

      <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="catalog-text">
        Paste or type
      </label>
      <textarea
        id="catalog-text"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
        }}
        rows={7}
        spellCheck={false}
        placeholder={'5305-01-234-5678\nMS51957-26\n5330\n1Q0C4\no-ring'}
        className="mono mt-1 w-full resize-y rounded-md border border-line-strong bg-canvas px-2.5 py-2 text-[13px] leading-relaxed placeholder:text-ink-3 hover:border-ink-3 focus:border-ink focus:outline-none"
      />
      <p className="mt-1 text-xs text-ink-3">
        One per line or comma-separated: NSNs, NIINs, part numbers, 4-digit FSCs, CAGE codes, or keywords.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          Treat as
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value as KindChoice)}
            className="rounded-md border border-line-strong bg-canvas px-2 py-1.5 text-[13px] text-ink hover:border-ink-3"
          >
            <option value="auto">Auto-detect</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k].many}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={button.secondary} onClick={() => fileInput.current?.click()}>
          <DocIcon size={15} />
          Import CSV or text file
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setFile({ name: f.name, raw: await f.text() });
            setResult(null);
          }}
        />
      </div>
      <p className="mt-1 text-xs text-ink-3">
        From Excel, save as CSV. Columns named NSN, Part Number, FSC, CAGE or Keyword are picked up automatically.
      </p>

      {file && parsedFile && (
        <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{file.name}</span>
            <button
              type="button"
              onClick={() => setFile(null)}
              aria-label="Remove file"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-hover hover:text-ink"
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {parsedFile.entries.length === 0
              ? 'No usable values found. Check the file has a column of NSNs, part numbers, FSCs or CAGEs.'
              : parsedFile.columns.length
                ? `Using ${parsedFile.columns.map((c) => `“${c.header}” as ${KIND_LABELS[c.kind].many}`).join(', ')}`
                : `${pluralize(parsedFile.entries.length, 'value')} found`}
          </p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="mt-4 border-t border-line pt-3" aria-live="polite">
          <p className="text-[13px] text-ink-2">
            {byKind.length ? (
              <>
                Ready to add{' '}
                {byKind.map((k, i) => (
                  <span key={k.kind}>
                    {i > 0 && ', '}
                    <span className="tnum font-semibold text-ink">{fmtNumber(k.n)}</span>{' '}
                    {k.n === 1 ? KIND_LABELS[k.kind].one : KIND_LABELS[k.kind].many}
                  </span>
                ))}
              </>
            ) : (
              'Nothing valid to add yet.'
            )}
          </p>
          {invalid.length > 0 && (
            <p className="mt-1 text-xs text-urgent">
              {pluralize(invalid.length, 'entry', 'entries')} won't be added:{' '}
              {invalid
                .slice(0, 5)
                .map((e) => `${e.value} (not a valid ${KIND_LABELS[e.kind].one})`)
                .join(', ')}
              {invalid.length > 5 && ', …'}
            </p>
          )}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
              className="size-3.5 accent-ink"
            />
            Replace my current catalog instead of adding to it
          </label>
          <button
            type="button"
            className={`${button.primary} mt-3 w-full`}
            disabled={!valid.length || add.isPending}
            onClick={() => add.mutate()}
          >
            {add.isPending
              ? 'Adding…'
              : `${replace ? 'Replace catalog with' : 'Add'} ${pluralize(valid.length, 'item')}`}
          </button>
          {add.isError && <p className="mt-2 text-xs text-urgent">Couldn't save. Is the API running? Try again.</p>}
        </div>
      )}

      {result && (
        <p className="mt-3 rounded-md border border-positive/30 bg-positive-soft px-3 py-2 text-[13px] text-positive">
          Added {pluralize(result.added, 'item')}
          {result.duplicates > 0 && `, ${fmtNumber(result.duplicates)} already in your catalog`}
          {result.invalid.length > 0 && `, ${fmtNumber(result.invalid.length)} rejected`}.
        </p>
      )}

      {isEmpty && !text && !file && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-ink-3">
          Not sure where to start?{' '}
          <button type="button" className={button.link} onClick={() => setText(EXAMPLE)}>
            Load an example
          </button>{' '}
          for a fasteners and seals distributor.
        </p>
      )}
    </section>
  );
}

const PAGE = 200;

function CatalogList({
  items,
  loading,
  error,
  onChanged,
  onPivot,
}: {
  items: CatalogItem[] | undefined;
  loading: boolean;
  error: boolean;
  onChanged: () => void;
  onPivot: (patch: Partial<Filters>) => void;
}) {
  const [kind, setKind] = useState<CatalogKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [confirmClear, setConfirmClear] = useState(false);

  const remove = useMutation({
    mutationFn: (i: CatalogItem) => api.removeCatalogItem(i.kind, i.norm),
    onSuccess: onChanged,
  });
  const clear = useMutation({ mutationFn: api.clearCatalog, onSuccess: onChanged });

  const all = items ?? [];
  const counts = Object.fromEntries(KINDS.map((k) => [k, all.filter((i) => i.kind === k).length])) as Record<
    CatalogKind,
    number
  >;
  const q = query.trim().toLowerCase();
  const visible = all.filter(
    (i) => (kind === 'all' || i.kind === kind) && (!q || i.value.toLowerCase().includes(q) || i.norm.includes(q)),
  );

  const pivotFor = (i: CatalogItem): Partial<Filters> => {
    switch (i.kind) {
      case 'fsc':
        return { fsc: [i.norm] };
      case 'cage':
        return { cage: i.norm };
      case 'nsn':
        return { q: i.norm };
      default:
        return { q: i.value };
    }
  };

  if (error) return <p className="text-[13px] text-urgent">Couldn't load your catalog.</p>;
  if (loading) return <p className="text-[13px] text-ink-3">Loading catalog…</p>;

  if (!all.length) {
    return (
      <section aria-label="Catalog" className="text-[13px]">
        <h2 className="text-[15px] font-semibold">Your catalog is empty</h2>
        <p className="mt-1 max-w-[65ch] text-ink-2">
          Add what you can supply, and RFQ Desk will flag every solicitation that matches. Each type of entry matches
          differently:
        </p>
        <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[8rem_1fr]">
          {KINDS.map((k) => (
            <div key={k} className="contents">
              <dt className="font-medium text-ink">{KIND_LABELS[k].many}</dt>
              <dd className="text-ink-2">{KIND_HELP[k]}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

  return (
    <section aria-label="Catalog">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Entry type" className="flex flex-wrap gap-1">
          {(['all', ...KINDS] as const).map((k) => {
            const n = k === 'all' ? all.length : counts[k];
            if (k !== 'all' && !n) return null;
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setKind(k);
                  setLimit(PAGE);
                }}
                className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                  active ? 'bg-ink text-canvas' : 'text-ink-2 hover:bg-hover hover:text-ink'
                }`}
              >
                {k === 'all' ? 'All' : KIND_LABELS[k].many}{' '}
                <span className={`tnum text-xs ${active ? 'text-canvas/70' : 'text-ink-3'}`}>{fmtNumber(n)}</span>
              </button>
            );
          })}
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in catalog"
          aria-label="Find in catalog"
          className="w-48 rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] placeholder:text-ink-3 hover:border-line-strong focus:border-ink focus:outline-none"
        />
      </div>

      <table className="mt-3 w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-3">
            <th className="w-28 py-2 font-medium">Type</th>
            <th className="py-2 font-medium">Value</th>
            <th className="w-32 py-2 text-right font-medium">Open RFQs</th>
            <th className="w-10 py-2">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.slice(0, limit).map((i) => (
            <tr key={`${i.kind}|${i.norm}`} className="group border-b border-line">
              <td className="py-1.5 text-ink-2">{KIND_LABELS[i.kind].one}</td>
              <td className={`py-1.5 text-ink ${i.kind === 'keyword' ? '' : 'mono'}`}>{i.value}</td>
              <td className="py-1.5 text-right">
                {i.openMatches > 0 ? (
                  <button
                    type="button"
                    onClick={() => onPivot(pivotFor(i))}
                    className={`tnum ${button.link}`}
                    title={`Show open RFQs for ${i.value}`}
                  >
                    {fmtNumber(i.openMatches)}
                  </button>
                ) : (
                  <span className="tnum text-ink-3">0</span>
                )}
              </td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  onClick={() => remove.mutate(i)}
                  aria-label={`Remove ${i.value}`}
                  title="Remove"
                  className="inline-flex size-7 items-center justify-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-urgent"
                >
                  <CloseIcon size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 && <p className="py-6 text-center text-[13px] text-ink-3">No entries match “{query}”.</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        {visible.length > limit ? (
          <button type="button" className={button.link} onClick={() => setLimit((l) => l + PAGE * 5)}>
            Show more ({fmtNumber(visible.length - limit)} hidden)
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => {
            if (confirmClear) {
              clear.mutate();
              setConfirmClear(false);
            } else setConfirmClear(true);
          }}
          onBlur={() => setConfirmClear(false)}
          className={`rounded-md px-2 py-1 font-medium transition-colors ${
            confirmClear ? 'bg-urgent text-canvas' : 'text-ink-3 hover:text-urgent'
          }`}
        >
          {confirmClear ? `Click again to remove all ${fmtNumber(all.length)}` : 'Clear catalog'}
        </button>
      </div>
    </section>
  );
}
