import { useState } from 'react';
import type { ClusterOverview } from './types';
import { formatDuration, relTime } from './format';

export function PendingPanel({ jobs, now }: { jobs: ClusterOverview['pendingOurs']; now: number }) {
  const [all, setAll] = useState(false);
  if (jobs.length === 0) return null;
  const shown = all ? jobs : jobs.slice(0, 25);
  const limited = jobs.filter((j) => j.limited).length;
  return (
    <section>
      <div className="panel-head">
        <h2>Pending jobs on tracked accounts</h2>
        <span className="muted small">{jobs.length}{jobs.length >= 300 ? '+' : ''} jobs · {jobs.length - limited} waiting on the queue · {limited} on limits or holds (oldest first)</span>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="data">
          <thead><tr><th>job</th><th>account</th><th>user</th><th>partitions</th><th>GPUs</th><th>limit</th><th>eligible for</th><th>reason</th><th title="Slurm's backfill estimate">est. start</th></tr></thead>
          <tbody>{shown.map((j) => (
            <tr key={j.jobId}>
              <td className="mono">{j.jobId}</td><td className="mono">{j.account}</td><td className="mono">{j.user}</td>
              <td className="mono">{j.partitions.join(',')}</td><td>{j.gpus}</td>
              <td>{j.timeLimitSec === null ? '–' : formatDuration(j.timeLimitSec)}</td>
              <td>{j.eligibleMs === null ? '–' : formatDuration(Math.max(0, Math.round((now - j.eligibleMs) / 1000)))}</td>
              <td><span className={`chip ${j.limited ? 'warn' : 'outline'}`} title={j.limited ? 'Waiting on a limit or hold, not on the queue: excluded from queue speed' : 'Waiting on the queue'}>{j.reason || 'None'}</span></td>
              <td>{j.estStartMs ? relTime(j.estStartMs, now) : '–'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {jobs.length > 25 && <button className="small" style={{ marginTop: 6 }} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${jobs.length}`}</button>}
    </section>
  );
}
