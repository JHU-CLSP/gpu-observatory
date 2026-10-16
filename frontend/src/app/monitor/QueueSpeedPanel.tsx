import { useId } from 'react';
import { GPU_CLASSES, TL_BUCKETS, type QueueSpeedResponse, type QueueSpeedRow, type SpeedScope, type SpeedWindow } from './types';
import { useHoverTip } from './charts/HoverTip';
import { fmtQuantile, fmtWait, waitBin, WAIT_BINS } from './format';
import { relTime } from './format';

const THIN = 5;
const ALL_USERS_HELP = 'Compare queue waits across all accounts visible to this monitor, including accounts outside the tracked groups. The user perspective selection does not filter this sample.';
const TRACKED_ACCOUNTS_HELP = 'Show queue waits only for the accounts listed in the Accounts section, including jobs from all users in those accounts.';
const LIMITED_WAITS_HELP = 'Include jobs delayed by account or QoS limits, holds, or other scheduling restrictions. Leave unchecked to focus on ordinary queue waits. Time spent waiting on dependencies is excluded either way.';

/**
 * "How long does a job of this shape wait here?" — rows partition × GPU class, columns time-limit
 * buckets, each cell the median and p90 wait (Kaplan–Meier, so jobs still waiting count) coloured
 * by the median on a single-hue ramp. The table itself is the accessible view; hover or focus a
 * cell for the counts behind it.
 */
export function QueueSpeedPanel({ speed, loading, win, scope, setScope, limited, setLimited, now }: {
  speed: QueueSpeedResponse | null; loading: boolean; win: SpeedWindow; now: number;
  scope: SpeedScope; setScope: (s: SpeedScope) => void; limited: boolean; setLimited: (v: boolean) => void;
}) {
  const { bind, node } = useHoverTip();
  const helpId = useId();
  const rows = speed?.rows ?? [];
  const byKey = new Map(rows.map((r) => [`${r.partition}|${r.gpuClass}|${r.tl}`, r]));
  // Only partitions our accounts can submit to; sacct also sees jobs on the rest (b200, …).
  const order = speed?.partitions ?? [];
  const other = [...new Set(rows.map((r) => r.partition).filter((p) => !order.includes(p)))].sort();
  const parts = order.map((p) => ({ p, classes: GPU_CLASSES.filter((g) => rows.some((r) => r.partition === p && r.gpuClass === g.key)) })).filter((x) => x.classes.length);

  return (
    <section>
      <div className="panel-head">
        <h2>Queue speed by request size</h2>
        <span className="seg" role="group" aria-label="whose jobs">
          <button className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'} aria-describedby={`${helpId}-all`} onClick={() => setScope('all')} {...bind(ALL_USERS_HELP)}>All users</button>
          <button className={scope === 'ours' ? 'on' : ''} aria-pressed={scope === 'ours'} aria-describedby={`${helpId}-ours`} onClick={() => setScope('ours')} {...bind(TRACKED_ACCOUNTS_HELP)}>Tracked accounts</button>
        </span>
        <label className="small muted" {...bind(LIMITED_WAITS_HELP)}><input type="checkbox" checked={limited} aria-describedby={`${helpId}-limited`} onChange={(e) => setLimited(e.target.checked)} /> include limit-/hold-bound waits</label>
        <span className="muted small">last {win}{speed?.sacctSyncedToMs ? ` · history synced ${relTime(speed.sacctSyncedToMs, now)}` : ''}</span>
      </div>
      <span id={`${helpId}-all`} className="sr-only">{ALL_USERS_HELP}</span>
      <span id={`${helpId}-ours`} className="sr-only">{TRACKED_ACCOUNTS_HELP}</span>
      <span id={`${helpId}-limited`} className="sr-only">{LIMITED_WAITS_HELP}</span>
      <div className="row small" style={{ marginBottom: 6 }}>
        <span className="muted">median wait:</span>
        <span className="heat-scale">{WAIT_BINS.map((b, i) => <span key={b.label} className={`heat-key b${i}`}>{b.label}</span>)}</span>
        <span className="heat-scale"><span className="heat-key thin">outlined</span></span><span className="muted">= fewer than {THIN} jobs</span>
        <span className="muted">· each cell: median · p90, n = jobs</span>
      </div>
      <div className={`card${loading ? ' refetching' : ''}`} style={{ padding: 0, overflowX: 'auto' }}>
        {parts.length === 0 ? (
          <div className="muted" style={{ padding: 12 }}>{speed ? `No GPU jobs with a queue wait in the last ${win}${scope === 'ours' ? ' on tracked accounts' : ''}.` : 'Loading…'}</div>
        ) : (
          <table className="data heat">
            <thead><tr><th>partition</th><th>GPUs</th>{TL_BUCKETS.map((b) => <th key={b.key} style={{ textAlign: 'center' }}>limit {b.label}</th>)}</tr></thead>
            <tbody>
              {parts.map(({ p, classes }) => classes.map((g, gi) => (
                <tr key={`${p}|${g.key}`} style={gi === 0 ? { borderTop: '2px solid var(--border-subtle)' } : undefined}>
                  {gi === 0 && <td rowSpan={classes.length} className="mono" style={{ verticalAlign: 'top' }}>{p}</td>}
                  <td className="muted">{g.label}</td>
                  {TL_BUCKETS.map((b) => {
                    const r = byKey.get(`${p}|${g.key}|${b.key}`);
                    if (!r) return <td key={b.key} className="cell-empty" aria-label="no jobs">·</td>;
                    return <Cell key={b.key} r={r} label={`${p} · ${g.label} · limit ${b.label}`} bind={bind} />;
                  })}
                </tr>
              )))}
            </tbody>
          </table>
        )}
      </div>
      <div className="muted small" style={{ marginTop: 4 }}>
        Wait = Eligible → Start, so dependency waits do not count. Jobs still pending or cancelled before starting count as "waited at least this long"
        (Kaplan–Meier), which is why a quantile can read ≥; an array or a burst of identical jobs counts once (its first job to start); requeued attempts and
        reservation jobs are left out, and so, unless included above, are waits on account/QoS limits and holds — they say nothing about the queue.
        A job that listed several partitions counts where it ran and as still waiting on the others.
        {other.length > 0 && ` Not shown (not reachable from our accounts): ${other.join(', ')}.`}
      </div>
      {node}
    </section>
  );
}

function Cell({ r, label, bind }: { r: QueueSpeedRow; label: string; bind: ReturnType<typeof useHoverTip>['bind'] }) {
  const thin = r.n < THIN;
  const bin = waitBin(r.p50Sec ?? r.atLeastSec);
  const tip = (
    <div>
      <div><strong>{label}</strong></div>
      <div>median wait {fmtQuantile(r.p50Sec, r.atLeastSec)} · p90 {fmtQuantile(r.p90Sec, r.atLeastSec)}</div>
      <div className="muted">{r.n} job{r.n === 1 ? '' : 's'}: {r.events} started, {r.censored} still waiting or cancelled</div>
      <div className="muted">{Math.round(r.immediateFrac * 100)}% of starts within a minute</div>
      {r.pendingNow.n > 0 && <div className="muted">waiting now: {r.pendingNow.n}, median {fmtWait(r.pendingNow.medianAgeSec)}, oldest {fmtWait(r.pendingNow.oldestAgeSec)}</div>}
      {thin && <div className="muted">few jobs — treat as a rough hint</div>}
    </div>
  );
  return (
    <td className={`cell-heat heat b${bin}${thin ? ' thin' : ''}`} tabIndex={0}
      aria-label={`${label}: median ${fmtQuantile(r.p50Sec, r.atLeastSec)}, p90 ${fmtQuantile(r.p90Sec, r.atLeastSec)}, ${r.n} jobs`} {...bind(tip)}>
      <div>{fmtQuantile(r.p50Sec, r.atLeastSec)}<span className="n"> · {fmtQuantile(r.p90Sec, r.atLeastSec)}</span></div>
      <div className="n">n={r.n}{r.pendingNow.n ? ` · ${r.pendingNow.n} now` : ''}</div>
    </td>
  );
}
