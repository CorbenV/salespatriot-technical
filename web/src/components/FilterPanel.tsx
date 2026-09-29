import { useEffect, useId, useMemo, useState } from 'react';
import type { FacetOption, ListResponse, Posted, SourcesFilter, Status } from '../api';
import { fmtNumber } from '../format';
import { SET_ASIDE_LABELS, SOL_TYPE_LABELS } from '../labels';
import type { Filters } from '../useFilters';
import { countActive } from '../useFilters';

interface Props {
  filters: Filters;
  facets: ListResponse['facets'] | undefined;
  setFilters: (patch: Partial<Filters>) => void;
  reset: () => void;
  onOpenCatalog: () => void;
}

export function FilterPanel({ filters, facets, setFilters, reset, onOpenCatalog }: Props) {
  const active = countActive(filters);
  const catalogSize = facets?.mine.catalogSize ?? 0;
  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      <Section title="Show">
        <Segmented<'all' | 'mine'>
          name="scope"
          value={filters.mine ? 'mine' : 'all'}
          onChange={(v) => {
            // With nothing in the catalog there is nothing to show: go set it up instead.
            if (v === 'mine' && !catalogSize) onOpenCatalog();
            else setFilters({ mine: v === 'mine' });
          }}
          options={[
            { value: 'all', label: 'All RFQs' },
            { value: 'mine', label: 'My catalog', count: catalogSize ? facets?.mine.count : undefined },
          ]}
        />
        <p className="mt-1.5 text-xs text-ink-3">
          {catalogSize ? (
            <>
              Matching {fmtNumber(catalogSize)} {catalogSize === 1 ? 'item' : 'items'} you sell or make.{' '}
              <button type="button" onClick={onOpenCatalog} className={linkClass}>
                Edit catalog
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onOpenCatalog} className={linkClass}>
                Add what you sell or make
              </button>{' '}
              to see only the RFQs relevant to you.
            </>
          )}
        </p>
      </Section>

      <Section
        title="Status"
        hint="Auto-evaluated RFQs can be awarded before the return-by date, and some stay open after it."
      >
        <Segmented<Status>
          name="status"
          value={filters.status}
          onChange={(status) => setFilters({ status })}
          options={[
            { value: 'open', label: 'Open', count: facets?.status.open },
            { value: 'closing', label: 'Closing ≤ 3d', count: facets?.status.closing },
            { value: 'closed', label: 'Past due', count: facets?.status.closed },
            { value: 'all', label: 'All', count: facets?.status.all },
          ]}
        />
      </Section>

      <Section
        title="First posted"
        hint="When the RFQ first appeared in a DIBBS daily file. Most are issued the next business day."
      >
        <Segmented<Posted>
          name="posted"
          value={filters.posted}
          onChange={(posted) => setFilters({ posted })}
          options={[
            { value: 'latest', label: 'Latest drop' },
            { value: '3d', label: '3 days' },
            { value: '7d', label: '7 days' },
            { value: 'all', label: 'Any' },
          ]}
        />
      </Section>

      <Section title="Set-aside" hint="Limit to solicitations you are eligible for.">
        <CheckList
          options={withSelected(facets?.setAside, filters.setAside, SET_ASIDE_LABELS)}
          selected={filters.setAside}
          onChange={(setAside) => setFilters({ setAside })}
        />
      </Section>

      <Section title="Solicitation type">
        <CheckList
          options={withSelected(facets?.solType, filters.solType, SOL_TYPE_LABELS)}
          selected={filters.solType}
          onChange={(solType) => setFilters({ solType })}
        />
      </Section>

      <Section title="Product class (FSC)">
        <FscList
          options={withSelected(facets?.fsc, filters.fsc)}
          selected={filters.fsc}
          onChange={(fsc) => setFilters({ fsc })}
        />
      </Section>

      <Section title="Total quantity">
        <QuantityRange
          min={filters.qtyMin}
          max={filters.qtyMax}
          onChange={(qtyMin, qtyMax) => setFilters({ qtyMin, qtyMax })}
        />
      </Section>

      <Section title="Approved sources" hint="Match RFQs where a CAGE is a listed approved source for the NSN.">
        <CageInput value={filters.cage} onChange={(cage) => setFilters({ cage })} />
        <div className="mt-2">
          <Segmented<SourcesFilter>
            name="sources"
            value={filters.sources}
            onChange={(sources) => setFilters({ sources })}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'with', label: 'Listed' },
              { value: 'without', label: 'None' },
            ]}
          />
        </div>
      </Section>

      <Section title="Deadline changes">
        <label className="flex cursor-pointer items-start gap-2 text-[13px] leading-snug text-ink-2">
          <input
            type="checkbox"
            checked={filters.amended}
            onChange={(e) => setFilters({ amended: e.target.checked })}
            className="mt-0.5 size-3.5 shrink-0 accent-ink"
          />
          Only re-posted RFQs whose return-by moved (usually extended)
        </label>
      </Section>

      {active > 0 && (
        <button
          type="button"
          onClick={reset}
          className="self-start text-[13px] font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
        >
          Clear {active} {active === 1 ? 'filter' : 'filters'}
        </button>
      )}
    </div>
  );
}

/** Keep selected values visible (with a 0 count) even when the current results have none. */
const linkClass = 'font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink';

function withSelected(
  options: FacetOption[] | undefined,
  selected: string[],
  labels: Record<string, string> = {},
): FacetOption[] {
  const list = options ?? [];
  const missing = selected
    .filter((v) => !list.some((o) => o.value === v))
    .map((v) => ({ value: v, label: labels[v] ?? v, count: 0 }));
  return [...list, ...missing];
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className={`text-[13px] font-semibold text-ink ${hint ? 'mb-0.5' : 'mb-2'}`}>
        {title}
      </h3>
      {hint && <p className="mb-2 text-xs leading-snug text-ink-3">{hint}</p>}
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={`grid gap-1 ${options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label
            key={o.value}
            className={`flex cursor-pointer items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-[13px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-ochre-strong ${
              checked
                ? 'border-ink bg-ink text-canvas'
                : 'border-line bg-canvas text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            <span className="truncate">{o.label}</span>
            {o.count !== undefined && (
              <span className={`tnum text-xs ${checked ? 'text-canvas/70' : 'text-ink-3'}`}>{fmtNumber(o.count)}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
  code,
  count,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  code?: string;
  count: number;
}) {
  return (
    <label
      className={`group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-hover ${
        count === 0 && !checked ? 'opacity-50' : ''
      }`}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="size-3.5 shrink-0 accent-ink" />
      {code && <span className="mono shrink-0 text-ink-2">{code}</span>}
      <span className={`min-w-0 flex-1 truncate ${checked ? 'font-medium text-ink' : 'text-ink-2'}`} title={label}>
        {label}
      </span>
      <span className="tnum shrink-0 text-xs text-ink-3">{fmtNumber(count)}</span>
    </label>
  );
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function CheckList({
  options,
  selected,
  onChange,
}: {
  options: FacetOption[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  if (!options.length) return <p className="px-1.5 text-[13px] text-ink-3">No values in current results</p>;
  return (
    <div className="-mx-1.5 flex flex-col">
      {options.map((o) => (
        <CheckRow
          key={o.value}
          checked={selected.includes(o.value)}
          onToggle={() => onChange(toggle(selected, o.value))}
          label={o.label}
          count={o.count}
        />
      ))}
    </div>
  );
}

const FSC_PREVIEW = 8;

function FscList({
  options,
  selected,
  onChange,
}: {
  options: FacetOption[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? options.filter((o) => o.value.includes(q) || o.label.toLowerCase().includes(q)) : options;
    const pinned = matches.filter((o) => selected.includes(o.value));
    const rest = matches.filter((o) => !selected.includes(o.value));
    return [...pinned, ...(expanded || q ? rest : rest.slice(0, Math.max(0, FSC_PREVIEW - pinned.length)))];
  }, [options, selected, query, expanded]);

  const hidden = options.length - visible.length;

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${fmtNumber(options.length)} classes`}
        aria-label="Search product classes"
        className="mb-1.5 w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] placeholder:text-ink-3 hover:border-line-strong focus:border-ink focus:outline-none"
      />
      <div className={`-mx-1.5 flex flex-col ${expanded ? 'max-h-80 overflow-y-auto' : ''}`}>
        {visible.map((o) => (
          <CheckRow
            key={o.value}
            checked={selected.includes(o.value)}
            onToggle={() => onChange(toggle(selected, o.value))}
            code={o.value === 'none' ? undefined : o.value}
            label={o.label}
            count={o.count}
          />
        ))}
        {visible.length === 0 && <p className="px-1.5 py-1 text-[13px] text-ink-3">No matching classes</p>}
      </div>
      {!query && (hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          {expanded ? 'Show fewer' : `Show all ${fmtNumber(options.length)}`}
        </button>
      )}
    </div>
  );
}

function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft] as const;
}

const inputClass =
  'tnum w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] placeholder:text-ink-3 hover:border-line-strong focus:border-ink focus:outline-none';

function QuantityRange({
  min,
  max,
  onChange,
}: {
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
}) {
  const [dMin, setMin] = useDraft(min);
  const [dMax, setMax] = useDraft(max);
  const commit = () => {
    if (dMin !== min || dMax !== max) onChange(dMin, dMax);
  };
  const clean = (s: string) => s.replace(/\D/g, '');
  return (
    <div className="flex items-center gap-2">
      <input
        inputMode="numeric"
        value={dMin}
        onChange={(e) => setMin(clean(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="Min"
        aria-label="Minimum total quantity"
        className={inputClass}
      />
      <span className="text-ink-3" aria-hidden="true">
        –
      </span>
      <input
        inputMode="numeric"
        value={dMax}
        onChange={(e) => setMax(clean(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        placeholder="Max"
        aria-label="Maximum total quantity"
        className={inputClass}
      />
    </div>
  );
}

function CageInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useDraft(value);
  const valid = draft === '' || /^[A-Z0-9]{5}$/.test(draft);
  return (
    <div>
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 5);
          setDraft(v);
          if (v.length === 5 || v === '') onChange(v);
        }}
        placeholder="CAGE code, e.g. 1Q0C4"
        aria-label="Approved source CAGE code"
        aria-invalid={!valid}
        spellCheck={false}
        className={`mono ${inputClass} ${valid ? '' : 'border-urgent'}`}
      />
      {!valid && <p className="mt-1 text-xs text-urgent">CAGE codes are 5 letters or digits</p>}
    </div>
  );
}
