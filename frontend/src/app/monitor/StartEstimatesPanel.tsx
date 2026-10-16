import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { clusterApi } from './api'
import { useHoverTip } from './charts/HoverTip'
import { fmtWait, relTime } from './format'
import type { StartEstimatesResponse } from './types'

const HELP = {
  account: 'Slurm subaccount whose allocation, default quality of service (QoS), and scheduling limits apply to the test. Only tracked accounts with an underscore suffix and an association for the server’s Slurm user are listed.',
  partition: 'Slurm queue to test. The partition determines the GPU pool and scheduling rules; account access and resource limits can affect whether the request is accepted.',
  cpus: 'CPUs requested for each GPU; defaults to 8. Each row requests this value multiplied by its GPU count. For example, 8 CPUs per GPU with 4 GPUs requests 32 CPUs in total. Changing this setting only reads cached results; select Probe now to request tests.',
  memory: 'System RAM requested for each GPU, in GiB. This is host memory, not GPU memory (VRAM). For example, 64 GiB per GPU with 4 GPUs requests 256 GiB of RAM in total.',
  probe: 'Request nine Slurm tests: 1, 4, and 8 GPUs for three time limits. New batches alternate between 1/12/48 hours and 4/24/72 hours, retaining the other results. The latest batch is reused for 15 minutes. Tests run only on request, submit no jobs, and allow at most one new batch per minute across all browsers.',
  gpus: 'Number of GPUs requested on a single node: 1, 4, or 8. The CPU and system RAM totals scale with this count.',
  time: 'Requested maximum running time: 1, 4, 12, 24, 48, or 72 hours. This is how long the job may run after starting, not how long it may wait in the queue. Each batch checks three of these limits; the next batch checks the other three.',
  resources: 'Total CPUs and system RAM requested by this row. Each total is the per-GPU setting multiplied by the number of GPUs. Memory is shown in GiB and does not include GPU VRAM.',
  start: 'Start time predicted by Slurm when this row was checked, shown in the server’s time zone. It is an estimate, not a reservation or guarantee, and may change as the queue changes. A missing estimate does not mean an immediate start.',
  wait: 'Estimated delay from the time this row was checked until its predicted start, with past start times shown as zero. This is a saved estimate, not a live countdown or a historical average. A dash means no usable estimate was returned.',
  checked: 'How long ago this row was tested. Each batch updates half the table and retains the other half with its original timestamps. Rows at least 15 minutes old are marked stale. Not probed yet means no test has been requested for that row.',
  updated: 'How long ago the latest batch finished for these settings. A batch checks half the time limits; the other rows keep their older results. All browsers share these results, and the next batch can run after 15 minutes.',
  output: 'Expand Output to see Slurm’s response, including any warnings or reasons the request failed. An exit code other than zero marks a failed test. Test mode does not submit a job.',
}
const COLUMNS = [
  ['gpus', 'GPUs'], ['time', 'time limit'], ['resources', 'CPUs / memory'], ['start', 'estimated start'],
  ['wait', 'wait at probe'], ['checked', 'checked'], ['output', 'Slurm response'],
] as const

export function StartEstimatesPanel({ now, tz }: { now: number; tz: string }) {
  const { bind, node } = useHoverTip()
  const helpId = useId()
  const help = (key: keyof typeof HELP) => ({ ...bind(HELP[key]), 'aria-describedby': `${helpId}-${key}` })
  const [account, setAccount] = useState('')
  const [partition, setPartition] = useState('')
  const [cpus, setCpus] = useState(8)
  const [memory, setMemory] = useState(64)
  const [data, setData] = useState<StartEstimatesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const session = useRef<AbortController | null>(null)
  const params = new URLSearchParams({ cpus_per_gpu: String(cpus), memory_gib_per_gpu: String(memory) })
  if (account) params.set('account', account)
  if (partition) params.set('partition', partition)
  const query = params.toString()

  const load = useCallback(async (method: 'GET' | 'POST' = 'GET') => {
    const controller = session.current
    if (!controller || controller.signal.aborted || busyRef.current) return
    if (method === 'POST') { busyRef.current = true; setBusy(true) }
    try {
      const next = await clusterApi<StartEstimatesResponse>(`/start-estimates?${query}`, { method, signal: controller.signal })
      if (!controller.signal.aborted) { setData(next); setError(null) }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message)
    } finally {
      if (method === 'POST' && !controller.signal.aborted) { busyRef.current = false; setBusy(false) }
    }
  }, [query])

  useEffect(() => {
    const controller = new AbortController()
    session.current = controller
    busyRef.current = false
    setBusy(false); setData(null); setError(null)
    void load()
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    return () => { controller.abort(); clearInterval(poll) }
  }, [load])

  const startLabel = (ms: number) => new Intl.DateTimeFormat(undefined, {
    timeZone: tz || undefined, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(ms)
  const stale = data?.checkedAtMs != null && now - data.checkedAtMs >= data.cacheSeconds * 1000
  const cachedRows = new Map(data?.rows.map(row => [`${row.gpus}-${row.timeLimitMinutes}`, row]))
  const profiles = [1, 4, 8].flatMap(gpus => (data?.timeLimitsMinutes ?? []).map(minutes => ({ gpus, minutes })))
  const nextBatch = data?.nextTimeLimitsMinutes?.map(minutes => `${minutes / 60}h`).join(', ')
  const nextBatchWait = data?.checkedAtMs != null ? Math.max(0, (data.checkedAtMs + data.cacheSeconds * 1000 - now) / 1000) : 0

  return <section aria-label="Scheduler start estimates">
    <div className="panel-head"><h2>Scheduler start estimates</h2><span className="muted small">Current queue · Slurm test mode</span></div>
    <p className="muted small" style={{ marginBottom: 10 }}>
      Runs as <strong>{data?.probeUser || 'the server’s Slurm user'}</strong>; User perspective does not change this identity.
      {' '}Each test requests one node and one task with the account’s default QoS. No job is submitted. Start times are estimates and may change.
    </p>
    <div className="toolbar probe-controls">
      <label {...bind(HELP.account)}><span className="probe-help">Account</span><select aria-label="Probe account" aria-describedby={`${helpId}-account`} value={account || data?.account || ''} onChange={e => setAccount(e.target.value)} disabled={!data || busy}>
        {!data?.accounts.length && <option value="">No accounts available</option>}
        {data?.accounts.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label {...bind(HELP.partition)}><span className="probe-help">Partition</span><select aria-label="Probe partition" aria-describedby={`${helpId}-partition`} value={partition || data?.partition || ''} onChange={e => setPartition(e.target.value)} disabled={!data || busy}>
        {!data?.partitions.length && <option value="">No partitions available</option>}
        {data?.partitions.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <label {...bind(HELP.cpus)}><span className="probe-help">CPUs / GPU</span><select aria-label="Probe CPUs per GPU" aria-describedby={`${helpId}-cpus`} value={cpus} onChange={e => setCpus(Number(e.target.value))} disabled={busy}>
        {[1, 2, 4, 8, 16, 32].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label {...bind(HELP.memory)}><span className="probe-help">GiB / GPU</span><select aria-label="Probe memory per GPU" aria-describedby={`${helpId}-memory`} value={memory} onChange={e => setMemory(Number(e.target.value))} disabled={busy}>
        {[8, 16, 32, 64, 128, 256].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <span {...bind(HELP.probe)}><button aria-describedby={`${helpId}-probe`} onClick={() => void load('POST')} disabled={busy || !data?.available}>{busy ? 'Probing…' : 'Probe now'}</button></span>
      {data?.checkedAtMs != null && <span className="muted small probe-help" tabIndex={0} {...help('updated')}>checked {relTime(data.checkedAtMs, now)}{stale ? ' · awaiting a new probe' : ''}</span>}
    </div>
    {(error || data?.error) && <p className="banner warn" role="status">{error || data?.error}</p>}
    {nextBatch && <p className="muted small" style={{ marginBottom: 6 }}>Next batch: {nextBatch} × 1, 4, 8 GPUs · 9 checks{nextBatchWait > 0 ? ` · eligible in ${fmtWait(nextBatchWait)}` : ''}.</p>}
    {busy && <p className="muted small" role="status">Checking nine requests sequentially. Previous estimates remain visible; only this half of the table will be updated.</p>}
    {data && !data.rows.length && <p className="muted small" style={{ marginBottom: 6 }}>No cached estimates for these settings. Select Probe now to check the first half of the table.</p>}
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      {!data ? <p className="muted" style={{ padding: 12 }}>Loading scheduler estimates…</p> :
        <table className="data probe-table">
          <thead><tr>{COLUMNS.map(([key, label]) => <th key={key} scope="col" className="probe-help" tabIndex={0} {...help(key)}>{label}</th>)}</tr></thead>
          <tbody>{profiles.map(({ gpus, minutes }) => {
            const row = cachedRows.get(`${gpus}-${minutes}`)
            return <tr key={`${gpus}-${minutes}`}>
              <td>{gpus}</td><td>{minutes / 60}h</td><td>{row?.cpus ?? cpus * gpus} / {row?.memoryGib ?? memory * gpus} GiB</td>
              <td>{!row ? 'Not probed yet' : row.estimatedStartMs === null ? (row.status === 'error' ? 'Request rejected / failed' : 'No estimate') : startLabel(row.estimatedStartMs)}</td>
              <td>{row?.waitSec == null ? '—' : fmtWait(row.waitSec)}</td><td>{row ? <>{relTime(row.checkedAtMs, now)}{now - row.checkedAtMs >= data.cacheSeconds * 1000 ? ' · stale' : ''}</> : '—'}</td>
              <td>{row ? <details><summary {...help('output')}>Output{row.status === 'error' ? ` (exit ${row.exitCode})` : /warn|error|failed/i.test(row.output) ? ' (warnings)' : ''}</summary><pre className="probe-output" tabIndex={0}>{row.output || '(No output)'}</pre></details> : '—'}</td>
            </tr>
          })}</tbody>
        </table>}
    </div>
    <p className="muted small" style={{ marginTop: 6 }}>Only Probe now sends tests; changing settings and polling read cached data. Each new batch checks half the time limits and keeps the other results. Batches for the same settings are at least 15 minutes apart. All browsers share the cache and a limit of one new batch per minute.</p>
    {Object.entries(HELP).map(([key, text]) => <span key={key} id={`${helpId}-${key}`} className="sr-only">{text}</span>)}
    {node}
  </section>
}
