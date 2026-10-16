// Pure helpers for the hand-rolled SVG charts (no chart library: the page CSP is 'self').

/** A linear map from [d0, d1] to [r0, r1]; a zero-width domain maps to the range start. */
export function scaleLinear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  return (v) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0));
}

/** A clean axis top for `max` (1, 2, 2.5, 5 × 10^k) and its evenly spaced ticks from 0. */
export function niceTicks(max: number, count = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { top, ticks };
}

/** SVG path for a series; a null value breaks the line (a gap, never an interpolated zero). */
export function linePath(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''; let pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** A series split into measured (solid) and reconstructed (dashed) runs; the measured points next
 *  to a reconstructed run are in both, so the line stays continuous. No mask → all solid. */
export function splitByMask(values: (number | null)[], mask?: boolean[]): { solid: (number | null)[]; dashed: (number | null)[] } {
  if (!mask || !mask.some(Boolean)) return { solid: values, dashed: values.map(() => null) };
  return {
    solid: values.map((v, i) => (mask[i] ? null : v)),
    dashed: values.map((v, i) => (mask[i] || mask[i - 1] || mask[i + 1] ? v : null)),
  };
}

/** Index of the data position nearest to pixel `px`, for a crosshair that snaps to data. */
export function nearestIndex(n: number, px: number, x: (i: number) => number): number {
  if (n <= 0) return -1;
  let best = 0; let dist = Infinity;
  for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - px); if (d < dist) { dist = d; best = i; } }
  return best;
}

/** The last non-null value and its index (for end labels and end dots). */
export function lastValue(values: (number | null)[]): { i: number; v: number } | null {
  for (let i = values.length - 1; i >= 0; i--) { const v = values[i]; if (v !== null && v !== undefined && Number.isFinite(v)) return { i, v }; }
  return null;
}
