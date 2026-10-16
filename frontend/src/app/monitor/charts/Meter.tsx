import { meterTone } from '../format';

/** A used/cap bar: severity lives in the fill (accent → warning at 80 % → danger at the cap), the
 *  numbers stay in text ink. No cap → the number alone. */
export function Meter({ used, cap, text, title, width }: { used: number; cap: number | null; text?: string; title?: string; width?: number }) {
  const label = text ?? (cap === null ? `${fmtN(used)}` : `${fmtN(used)}/${fmtN(cap)}`);
  if (cap === null || cap <= 0) return <span className="meter" title={title}>{label}</span>;
  const f = Math.max(0, Math.min(1, used / cap));
  const tone = meterTone(used, cap);
  return (
    <span className="meter" title={title} role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={used} aria-label={title ?? label}>
      <span className="track" style={width ? { width } : undefined}><span className={`fill${tone === 'accent' ? '' : ' ' + tone}`} style={{ width: `${(f * 100).toFixed(1)}%` }} /></span>
      <span>{label}</span>
    </span>
  );
}

function fmtN(x: number): string { return Number.isInteger(x) ? String(x) : x.toFixed(1); }
