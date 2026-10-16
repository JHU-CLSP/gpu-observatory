import { useState } from 'react';
import type { ClusterAccountView, ClusterGroupView } from './types';
import { Meter } from './charts/Meter';
import { Sparkline } from './charts/Sparkline';
import { fmtFs, fmtBudget } from './format';
import { fmtClock } from './format';

/** Highest fair share among member accounts with account headroom and no budget. */
export function bestAccount(groups: ClusterGroupView[]): string | null {
  const cands = groups.flatMap((g) => g.accounts).filter((a) => a.member && !a.budget && a.userFairshare !== null
    && (a.capGpus === null || a.run.gpus + a.pend.gpusQueue < a.capGpus));
  cands.sort((a, b) => b.userFairshare! - a.userFairshare!);
  return cands[0]?.account ?? null;
}

export function AccountsPanel({ groups, serverNowMs, tz, selectedUser }: { groups: ClusterGroupView[]; serverNowMs: number; tz: string; selectedUser: string | null }) {
  const best = bestAccount(groups);
  const trendStart = Math.floor((serverNowMs / 1000 - 86400) / 900) * 900;
  const labelAt = (i: number) => fmtClock((trendStart + i * 900) * 1000, tz);
  return (
    <section>
      <div className="panel-head">
        <h2>Accounts</h2>
        <span className="muted small">GPUs right now. Fair share is one scheduling priority factor; availability and other limits also matter.</span>
      </div>
      <div className="cluster-groups">
        {groups.map((g) => (
          <div className="card" key={g.name}>
            <div className="card-head">
              <strong>{g.name}</strong>
              <span className="muted small">{g.runGpus} GPUs running · {g.pendGpus} pending · {g.accounts.length} accounts</span>
            </div>
            <table className="data">
              <thead><tr><th>account</th><th title="Running GPUs against the tightest account-wide cap">running / cap</th><th title="GPUs of pending jobs waiting on the queue (Priority/Resources); limit- or hold-bound GPUs follow in grey">pending</th><th title="Selected user’s FairShare factor; L = account LevelFS">{selectedUser ? `${selectedUser} FS` : 'Account FS'}</th><th>budget</th><th>running, 24 h</th></tr></thead>
              <tbody>{g.accounts.map((a) => <AccountRow key={a.account} a={a} best={a.account === best} labelAt={labelAt} />)}</tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

function AccountRow({ a, best, labelAt }: { a: ClusterAccountView; best: boolean; labelAt: (i: number) => string }) {
  const [open, setOpen] = useState(false);
  const held = a.pend.gpus - a.pend.gpusQueue;
  const b = a.budget;
  return (
    <>
      <tr className={a.member === false ? 'muted' : undefined}>
        <td>
          {a.topUsers.length > 0
            ? <button className="small" style={{ padding: '0 4px', marginRight: 4 }} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`users of ${a.account}`}>{open ? '▾' : '▸'}</button>
            : <span style={{ display: 'inline-block', width: 22 }} />}
          <span className="mono">{a.account}</span>
          {best && <span className="chip accent" style={{ marginLeft: 6 }} title="Best fairshare among member accounts with quota left and no budget">best FS</span>}
          {a.member === false && <span className="chip outline" style={{ marginLeft: 6 }} title="The selected user is not a member of this account">not a member</span>}
          <div className="muted small" style={{ paddingLeft: 26 }}>{a.qos} · {a.users} user{a.users === 1 ? '' : 's'}</div>
        </td>
        <td><Meter used={a.run.gpus} cap={a.capGpus} title={`${a.run.gpus} GPUs in ${a.run.jobs} running job${a.run.jobs === 1 ? '' : 's'}${a.capGpus === null ? ', no GPU cap' : `, account cap ${a.capGpus}`}${a.userCapGpus !== null ? `, per-user cap ${a.userCapGpus}` : ''}`} />
          {a.capGpus === null && <span className="muted small"> no cap</span>}</td>
        <td title={`${a.pend.jobs} pending job${a.pend.jobs === 1 ? '' : 's'}: ${a.pend.gpusQueue} GPUs waiting on the queue, ${held} on limits or holds`}>
          {a.pend.gpusQueue}{held > 0 && <span className="muted small"> +{held} held</span>}
        </td>
        <td>{a.member !== null && <span className="mono">{fmtFs(a.userFairshare)} </span>}<span className="muted small mono">L {fmtFs(a.levelFs, a.levelFsInf)}</span></td>
        <td>{b ? <Meter used={b.used + b.committed} cap={b.limit} text={`${fmtBudget(b.used)} / ${fmtBudget(b.limit)} ${b.unit}`} width={60}
          title={`Usage budget (GrpTRESMins): ${fmtBudget(b.used)} used + ${fmtBudget(b.committed)} committed by running jobs of ${fmtBudget(b.limit)}; ${fmtBudget(b.remaining)} left. Units: ${b.unit}. Enforcement depends on cluster QoS settings.`} />
          : <span className="muted">—</span>}</td>
        <td><Sparkline values={a.trend} refValue={a.capGpus} labelAt={labelAt} ariaLabel={`${a.account} running GPUs, last 24 hours`} estimated={a.trendEst} /></td>
      </tr>
      {open && (
        <tr className="users"><td colSpan={6}>
          <span className="muted small">top users now: </span>
          {a.topUsers.map((u) => (
            <span key={u.user} className="chip outline" style={{ marginRight: 6 }} title={`FairShare factor ${fmtFs(u.fairshare)}`}>
              <span className="mono">{u.user}</span> {u.runGpus} run{u.pendGpus ? ` · ${u.pendGpus} pend` : ''}{u.fairshare !== null ? ` · FS ${fmtFs(u.fairshare)}` : ''}
            </span>
          ))}
        </td></tr>
      )}
    </>
  );
}
