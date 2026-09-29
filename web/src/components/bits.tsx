import { useState } from 'react';
import { fmtDate, fmtDaysLeft, urgency } from '../format';
import { CheckIcon, CopyIcon } from './icons';

const URGENCY_STYLES = {
  urgent: 'bg-urgent-soft text-urgent',
  soon: 'bg-ochre-soft text-ochre-ink',
  normal: 'text-ink',
  closed: 'text-ink-3',
} as const;

/** Time left to quote; color is reinforced by wording so it never relies on color alone. */
export function DaysLeft({ days, date }: { days: number; date: string }) {
  const u = urgency(days);
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span
        className={`tnum inline-flex items-center rounded py-px text-[13px] font-semibold whitespace-nowrap ${URGENCY_STYLES[u]} ${
          u === 'normal' || u === 'closed' ? '' : 'px-1.5'
        }`}
      >
        {fmtDaysLeft(days)}
      </span>
      <span className="tnum text-xs text-ink-3">{fmtDate(date)}</span>
    </div>
  );
}

export function Tag({
  children,
  tone = 'neutral',
  title,
  className = '',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'ochre' | 'positive';
  title?: string;
  className?: string;
}) {
  const tones = {
    neutral: 'border-line-strong text-ink-2',
    ochre: 'border-ochre/60 bg-ochre-soft text-ochre-ink',
    positive: 'border-positive/30 bg-positive-soft text-positive',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 text-[11px] leading-[18px] font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable (insecure context); ignore */
        }
      }}
      className="inline-flex size-6 items-center justify-center rounded text-ink-3 transition-colors hover:bg-hover hover:text-ink"
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
    >
      {copied ? <CheckIcon size={14} className="text-positive" /> : <CopyIcon size={14} />}
    </button>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mono inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-canvas px-1 text-[11px] text-ink-3">
      {children}
    </kbd>
  );
}
