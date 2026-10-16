import type { SeriesResponse, SpeedWindow } from './types';
import { LineChart } from './charts/LineChart';
import { fmtClock, fmtDateTime } from './format';

/** Fixed series order: colour follows the group (config order), never its rank. */
const GROUP_COLORS = ['var(--cluster-series-1)', 'var(--cluster-series-2)', 'var(--cluster-series-3)', 'var(--cluster-series-7)'];

export function TrendsPanel({ series, groupNames, win, tz }: { series: SeriesResponse | null; groupNames: string[]; win: SpeedWindow; tz: string }) {
  if (!series || series.t.length === 0) return null;
  const pick = (suffix: string) => groupNames.map((g, i) => ({
    name: g, color: GROUP_COLORS[i % GROUP_COLORS.length]!, values: series.series.find((s) => s.name === `${g} ${suffix}`)?.values ?? [],
  }));
  const day = new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, month: 'short', day: 'numeric' });
  const fmtTick = (ms: number) => (win === '24h' ? fmtClock(ms, tz) : day.format(new Date(ms)));
  const fmtTip = (ms: number) => fmtDateTime(ms, tz);
  const fmtY = (v: number) => (v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1));
  const step = series.stepSec >= 3600 ? `${series.stepSec / 3600} h` : `${series.stepSec / 60} min`;
  return (
    <section>
      <div className="panel-head"><h2>Usage over time</h2><span className="muted small">GPUs per PI group, last {win}, {step} averages</span></div>
      <div className="cluster-trends">
        <LineChart title="Running GPUs" t={series.t} series={pick('running')} fmtY={fmtY} fmtTick={fmtTick} fmtTip={fmtTip} estimated={series.estimated}
          note={series.estimated?.some(Boolean) ? 'Dashed: collection was unavailable; rebuilt from job history.' : undefined} />
        <LineChart title="GPUs waiting on the queue" t={series.t} series={pick('waiting')} fmtY={fmtY} fmtTick={fmtTick} fmtTip={fmtTip} estimated={series.estimated}
          note={`Pending GPUs whose reason is Priority/Resources; limit-, hold- and dependency-bound jobs are left out.${series.estimated?.some(Boolean) ? ' Dashed stretches are rebuilt from job history and approximate.' : ''}`} />
      </div>
    </section>
  );
}
