import type { ClusterPoolView, SeriesResponse, SpeedWindow } from './types';
import { useHoverTip } from './charts/HoverTip';
import { Sparkline } from './charts/Sparkline';
import { fmtDateTime } from './format';

const SEGS = [
  { key: 'used', cls: 'cap-used', label: 'used', hint: 'allocated to running jobs' },
  { key: 'planned', cls: 'cap-planned', label: 'planned', hint: 'idle but held by the scheduler for a pending job' },
  { key: 'reserved', cls: 'cap-reserved', label: 'reserved', hint: 'idle inside a reservation' },
  { key: 'down', cls: 'cap-down', label: 'down/drain', hint: 'on nodes that are down, draining or otherwise unusable' },
  { key: 'idle', cls: 'cap-idle', label: 'idle', hint: 'free for any job' },
] as const;

/** Per GPU pool (a partition and its hidden condo twin share nodes): the GPU split right now, the
 *  queue-bound demand, condo preemptions, and used GPUs over the chosen window. */
export function CapacityPanel({ capacity, pools, win, tz }: { capacity: ClusterPoolView[]; pools: SeriesResponse | null; win: SpeedWindow; tz: string }) {
  const { bind, node } = useHoverTip();
  if (capacity.length === 0) return null;
  return (
    <section>
      <div className="panel-head">
        <h2>GPU pools</h2>
        <span className="legend">{SEGS.map((s) => <span key={s.key} title={s.hint}><span className={`swatch ${s.cls}`} />{s.label}</span>)}</span>
        <span className="muted small">sparkline: GPUs used, last {win} (flat dashed line = pool size; dashed curve = rebuilt from job history while collection was unavailable)</span>
      </div>
      <div className="cluster-capacity">
        {capacity.map((p) => {
          const values = pools?.series.find((s) => s.name === p.pool)?.values ?? [];
          const condo = p.lanes.filter((l) => l.partition !== p.pool);
          return (
            <div className="card" key={p.pool}>
              <div className="row" style={{ marginBottom: 6 }}>
                <strong className="mono">{p.pool}</strong><span className="muted small">{p.total} GPUs</span><span className="grow" />
                {condo.map((l) => (
                  <span key={l.partition} className="chip outline small" title={`${l.hidden ? 'Hidden partition (sinfo -s does not list it). ' : ''}PriorityTier ${l.tier}: starts by requeueing jobs in lower tiers on the same nodes.`}>{l.partition} · tier {l.tier}</span>
                ))}
              </div>
              <div className="capbar" role="img" aria-label={`${p.pool}: ${SEGS.map((s) => `${p[s.key]} ${s.label}`).join(', ')} of ${p.total}`}>
                {SEGS.filter((s) => p[s.key] > 0).map((s) => (
                  <span key={s.key} className={s.cls} style={{ flex: p[s.key] }} {...bind(<span><strong>{p[s.key]}</strong> GPUs {s.label} ({Math.round((100 * p[s.key]) / Math.max(1, p.total))}%) — {s.hint}</span>)} />
                ))}
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {p.used} used · <strong>{p.idle}</strong> idle{p.planned ? ` · ${p.planned} planned` : ''}{p.reserved ? ` · ${p.reserved} reserved` : ''}{p.down ? ` · ${p.down} down` : ''}
              </div>
              <div className="small muted" title="GPUs requested by pending jobs that wait on Priority/Resources (not on limits), counted once per pool">
                {p.pendGpusQueue} GPUs waiting on the queue
              </div>
              {p.preempted7d > 0 && (
                <div className="small muted" title="Jobs ended as PREEMPTED (requeued by a higher-tier condo lane)">
                  preempted: {p.preempted24h} in 24 h · {p.preempted7d} in 7 d ({p.preemptedOurs7d} tracked)
                </div>
              )}
              {values.length > 0 && pools && (
                <div style={{ marginTop: 4 }}>
                  <Sparkline values={values} refValue={p.total} width={230} height={30} labelAt={(i) => fmtDateTime(pools.t[i], tz)} ariaLabel={`${p.pool} GPUs used, last ${win}`} estimated={pools.estimated} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {node}
    </section>
  );
}
