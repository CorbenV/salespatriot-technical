const num = new Intl.NumberFormat('en-US');
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

export const fmtNumber = (n: number) => num.format(n);
/** ISO yyyy-mm-dd -> "Oct 1" (dates are calendar dates, so format in UTC). */
export const fmtDate = (iso: string) => shortDate.format(new Date(`${iso}T00:00:00Z`));
export const fmtLongDate = (iso: string) => longDate.format(new Date(`${iso}T00:00:00Z`));
export const fmtTime = (isoDateTime: string) => time.format(new Date(isoDateTime));

export function fmtDaysLeft(days: number): string {
  if (days < 0) return 'Past due';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export type Urgency = 'closed' | 'urgent' | 'soon' | 'normal';
export function urgency(days: number): Urgency {
  if (days < 0) return 'closed';
  if (days <= 1) return 'urgent';
  if (days <= 3) return 'soon';
  return 'normal';
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}
