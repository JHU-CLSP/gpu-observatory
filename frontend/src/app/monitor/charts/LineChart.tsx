import { useEffect, useRef, useState } from 'react';
import { scaleLinear, niceTicks, linePath, nearestIndex, lastValue, splitByMask } from '../chart';

export interface LineSeries { name: string; color: string; values: (number | null)[] }

/**
 * Hand-rolled SVG line chart: one y axis from 0, recessive grid, 2px lines, a legend for ≥ 2
 * series plus end labels (name + last value) for ≤ 4, a crosshair that snaps to data with a
 * tooltip (pointer and ←/→ keys), and a table view of the same numbers.
 */
export function LineChart({ title, t, series, fmtY = (v) => String(Math.round(v)), fmtTick, fmtTip, height = 180, note, estimated }: {
  title: string; t: number[]; series: LineSeries[]; fmtY?: (v: number) => string;
  fmtTick: (ms: number) => string; fmtTip: (ms: number) => string; height?: number; note?: string;
  /** Per point: reconstructed, not measured — drawn dashed, flagged in the tooltip and table. */
  estimated?: boolean[];
}) {
  const anyEst = !!estimated?.some(Boolean);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver((es) => { const w = es[0]?.contentRect.width; if (w) setWidth(Math.max(240, Math.round(w))); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const endLabels = series.length <= 4;
  const M = { l: 38, r: endLabels ? 96 : 12, t: 8, b: 22 };
  const n = t.length;
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const { top, ticks } = niceTicks(max);
  const xs = scaleLinear(0, Math.max(1, n - 1), M.l, width - M.r);
  const x = (i: number) => xs(i);
  const y = scaleLinear(0, top, height - M.b, M.t);
  const xTicks = n < 2 ? [] : Array.from({ length: 5 }, (_, k) => Math.round((k * (n - 1)) / 4));

  // end labels: stack by value, then push apart so none overlap (12 px apart)
  const ends = endLabels ? series.map((s) => ({ s, last: lastValue(s.values) })).filter((e) => e.last)
    .map((e) => ({ ...e, y: y(e.last!.v) })).sort((a, b) => a.y - b.y) : [];
  for (let k = 1; k < ends.length; k++) if (ends[k]!.y - ends[k - 1]!.y < 12) ends[k]!.y = ends[k - 1]!.y + 12;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setHover(nearestIndex(n, e.clientX - box.left, x));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (n === 0) return;
    const cur = hover ?? n - 1;
    const next = e.key === 'ArrowLeft' ? cur - 1 : e.key === 'ArrowRight' ? cur + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (e.key === 'Escape') { setHover(null); return; }
    if (next === null) return;
    e.preventDefault(); setHover(Math.max(0, Math.min(n - 1, next)));
  };

  const hx = hover !== null ? x(hover) : 0;
  return (
    <div className="card chart" ref={wrap}>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="chart-title">{title}</span>
        {series.length >= 2 && (
          <span className="chart-legend">{series.map((s) => <span key={s.name}><i className="key" style={{ background: s.color, marginRight: 4 }} />{s.name}</span>)}</span>
        )}
        {anyEst && <span className="chart-legend" title="The dashboard was not running then: rebuilt from job history (sacct)"><i className="key dashed-key" style={{ marginRight: 4 }} />reconstructed</span>}
        <span className="grow" />
        <button className="small" onClick={() => setTable((v) => !v)} aria-pressed={table}>{table ? 'Chart' : 'Table'}</button>
      </div>
      {table ? (
        <div style={{ maxHeight: height + 40, overflow: 'auto' }}>
          <table className="data"><thead><tr><th>time</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
            <tbody>{t.map((_, i) => n - 1 - i).map((i) => (
              <tr key={i}><td className="mono">{fmtTip(t[i]!)}{estimated?.[i] ? <span className="muted"> (reconstructed)</span> : null}</td>{series.map((s) => <td key={s.name} className="mono">{s.values[i] == null ? '–' : fmtY(s.values[i]!)}</td>)}</tr>
            ))}</tbody></table>
        </div>
      ) : (
        <svg height={height} viewBox={`0 0 ${width} ${height}`} tabIndex={0} role="img" aria-label={`${title}. ${series.map((s) => `${s.name}: ${lastValue(s.values) ? fmtY(lastValue(s.values)!.v) : 'no data'}`).join('; ')}. Use arrow keys to read values.`}
          onKeyDown={onKey} onFocus={() => setHover((h) => h ?? (n ? n - 1 : null))} onBlur={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'baseline' : 'grid'} x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} />
              <text className="tick" x={M.l - 6} y={y(v) + 4} textAnchor="end">{fmtY(v)}</text>
            </g>
          ))}
          {xTicks.map((i, k) => (
            <text key={k} className="tick" x={x(i)} y={height - 6} textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'}>{fmtTick(t[i]!)}</text>
          ))}
          {series.map((s) => { const p = splitByMask(s.values, estimated); return (
            <g key={s.name}>
              <path className="series" d={linePath(p.solid, x, y)} style={{ stroke: s.color }} />
              {anyEst && <path className="series est" d={linePath(p.dashed, x, y)} style={{ stroke: s.color }} />}
            </g>
          ); })}
          {series.map((s) => s.values.map((v, i) => (v !== null && s.values[i - 1] == null && s.values[i + 1] == null
            ? <circle key={`${s.name}${i}`} cx={x(i)} cy={y(v)} r={2.5} style={{ fill: s.color }} /> : null)))}
          {ends.map((e) => (
            <g key={e.s.name}>
              <circle className="enddot" cx={x(e.last!.i)} cy={y(e.last!.v)} r={4} style={{ fill: e.s.color }} />
              <text className="endlabel" x={width - M.r + 8} y={e.y + 4}>{e.s.name} {fmtY(e.last!.v)}</text>
            </g>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line className="crosshair" x1={hx} x2={hx} y1={M.t} y2={height - M.b} />
              {series.map((s) => s.values[hover] == null ? null : <circle key={s.name} className="enddot" cx={hx} cy={y(s.values[hover]!)} r={4} style={{ fill: s.color }} />)}
            </g>
          )}
          <rect x={M.l} y={0} width={Math.max(0, width - M.l - M.r)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {!table && hover !== null && t[hover] !== undefined && (
        <div className="chart-tip" style={{ top: 34, ...(hx > width / 2 ? { right: width - hx + 12 } : { left: hx + 12 }) }}>
          <div className="muted" style={{ marginBottom: 2 }}>{fmtTip(t[hover]!)}{estimated?.[hover] ? ' · reconstructed' : ''}</div>
          {series.map((s) => (
            <div className="tip-row" key={s.name}><i className="key" style={{ background: s.color }} /><strong>{s.values[hover] == null ? '–' : fmtY(s.values[hover]!)}</strong><span className="muted">{s.name}</span></div>
          ))}
        </div>
      )}
      {note && <div className="muted small" style={{ marginTop: 4 }}>{note}</div>}
    </div>
  );
}
