// Pure formatting for the Cluster page.

/** "<1m", "12m", "3.4h", "2.1d"; null → "–". */
export function fmtWait(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '–';
  if (sec < 60) return '<1m';
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(sec < 36000 ? 1 : 0)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

/** A Kaplan–Meier quantile: the value, or "≥ x" when censoring left it unreached. */
export function fmtQuantile(sec: number | null, atLeastSec: number): string {
  return sec === null ? `≥${fmtWait(atLeastSec)}` : fmtWait(sec);
}

/** Wait → one of 6 ordered bins (the heat scale): <5m, 5–30m, 30m–2h, 2–8h, 8–24h, >24h. */
export const WAIT_BINS = [
  { max: 300, label: '<5m' }, { max: 1800, label: '5–30m' }, { max: 7200, label: '30m–2h' },
  { max: 28800, label: '2–8h' }, { max: 86400, label: '8–24h' }, { max: Infinity, label: '>24h' },
] as const;
export function waitBin(sec: number): number { return WAIT_BINS.findIndex((b) => sec < b.max); }

/** Meter severity for a used/cap pair: accent below 80 %, warning up to the cap, danger at it. */
export function meterTone(used: number, cap: number | null): 'accent' | 'warn' | 'bad' {
  if (cap === null || cap <= 0) return 'accent';
  const f = used / cap;
  return f >= 1 ? 'bad' : f >= 0.8 ? 'warn' : 'accent';
}

export function fmtBudget(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** Fairshare factor: 3 decimals, "inf" for an account with no usage share left to compare. */
export function fmtFs(v: number | null, inf = false): string {
  if (inf) return 'inf';
  return v === null ? '–' : v.toFixed(3);
}

export function formatDuration(sec: number): string { return fmtWait(sec); }

export function relTime(ms: number | null | undefined, now: number): string {
  if (ms == null) return 'never';
  const sec = Math.abs(now - ms) / 1000;
  return ms > now ? `in ${fmtWait(sec)}` : `${fmtWait(sec)} ago`;
}

export function fmtBytes(bytes: number): string {
  return bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

export function fmtClock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
}

export function fmtDateTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
}
