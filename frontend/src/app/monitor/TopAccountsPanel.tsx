import type { ClusterOverview } from './types';

/** Who holds the cluster's GPUs right now (every account, not only ours). */
export function TopAccountsPanel({ top }: { top: ClusterOverview['topAccounts'] }) {
  if (top.length === 0) return null;
  const max = Math.max(1, ...top.map((a) => a.runGpus));
  return (
    <section>
      <div className="panel-head"><h2>Largest GPU accounts, cluster-wide</h2><span className="muted small">by running GPUs now</span></div>
      <div className="card" style={{ padding: 0, maxWidth: 640, overflowX: 'auto' }}>
        <table className="data">
          <thead><tr><th>account</th><th>running GPUs</th><th>pending GPUs</th></tr></thead>
          <tbody>{top.map((a) => (
            <tr key={a.account}>
              <td><span className="mono">{a.account}</span>{a.ours && <span className="chip accent" style={{ marginLeft: 6 }}>tracked</span>}</td>
              <td><span className="row" style={{ flexWrap: 'nowrap' }}>
                <span className="minibar" style={{ background: 'var(--cluster-chart-track)' }}><span style={{ width: `${(100 * a.runGpus) / max}%`, background: 'var(--cluster-series-1)', borderRadius: 4 }} /></span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{a.runGpus}</span>
              </span></td>
              <td>{a.pendGpus}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
