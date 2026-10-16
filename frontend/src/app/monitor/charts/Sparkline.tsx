import { useState } from 'react';
import { scaleLinear, linePath, nearestIndex, lastValue, splitByMask } from '../chart';

/** A word-sized trend: one series (no legend; the row names it), an optional dashed reference
 *  line (a cap or pool size), an end dot, and a snap-to-data hover readout. */
export function Sparkline({ values, refValue, labelAt, fmtV = (v) => String(Math.round(v)), width = 110, height = 26, ariaLabel, estimated }: {
  values: (number | null)[]; refValue?: number | null; labelAt?: (i: number) => string; fmtV?: (v: number) => string;
  width?: number; height?: number; ariaLabel: string; estimated?: boolean[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return <span className="muted small">no data</span>;
  const max = Math.max(1, ...nums, refValue ?? 0);
  const x = scaleLinear(0, Math.max(1, n - 1), 2, width - 5);
  const y = scaleLinear(0, max, height - 3, 3);
  const last = lastValue(values);
  const shown = hover !== null && values[hover] != null ? { i: hover, v: values[hover]! } : null;
  return (
    <span className="chart" style={{ display: 'inline-block', width, verticalAlign: 'middle' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${ariaLabel}: now ${last ? fmtV(last.v) : '–'}, peak ${fmtV(Math.max(...nums))}`}
        onPointerMove={(e) => setHover(nearestIndex(n, e.clientX - e.currentTarget.getBoundingClientRect().left, x))} onPointerLeave={() => setHover(null)}>
        <line className="baseline" x1={2} x2={width - 5} y1={y(0)} y2={y(0)} />
        {refValue ? <line x1={2} x2={width - 5} y1={y(refValue)} y2={y(refValue)} stroke="var(--cluster-chart-axis)" strokeDasharray="3 3" strokeWidth={1} /> : null}
        {(() => { const p = splitByMask(values, estimated); return (<>
          <path className="series" d={linePath(p.solid, x, y)} style={{ stroke: 'var(--cluster-series-1)', strokeWidth: 1.5 }} />
          <path className="series est" d={linePath(p.dashed, x, y)} style={{ stroke: 'var(--cluster-series-1)', strokeWidth: 1.5 }} />
        </>); })()}
        {values.map((v, i) => (v !== null && values[i - 1] == null && values[i + 1] == null ? <circle key={i} cx={x(i)} cy={y(v)} r={1.5} style={{ fill: 'var(--cluster-series-1)' }} /> : null))}
        {(shown ?? last) && <circle className="enddot" cx={x((shown ?? last)!.i)} cy={y((shown ?? last)!.v)} r={3} style={{ fill: 'var(--cluster-series-1)', strokeWidth: 1.5 }} />}
      </svg>
      {shown && (
        <span className="chart-tip" style={{ bottom: height + 4, left: Math.min(x(shown.i), width - 60), whiteSpace: 'nowrap', minWidth: 0 }}>
          <strong>{fmtV(shown.v)}</strong>{labelAt ? <span className="muted"> · {labelAt(shown.i)}</span> : null}{estimated?.[shown.i] ? <span className="muted"> · reconstructed</span> : null}
        </span>
      )}
    </span>
  );
}
