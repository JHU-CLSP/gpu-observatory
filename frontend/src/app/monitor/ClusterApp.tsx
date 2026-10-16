import { useCallback, useEffect, useRef, useState } from 'react'
import { ClusterApiError, clusterApi } from './api'
import { SPEED_WINDOWS, type ClusterOverview, type QueueSpeedResponse, type SeriesResponse, type SpeedScope, type SpeedWindow } from './types'
import { AccountsPanel } from './AccountsPanel'
import { CapacityPanel } from './CapacityPanel'
import { QueueSpeedPanel } from './QueueSpeedPanel'
import { TrendsPanel } from './TrendsPanel'
import { PendingPanel } from './PendingPanel'
import { TopAccountsPanel } from './TopAccountsPanel'
import { fmtBytes, relTime } from './format'
import './cluster.css'

function useSavedChoice<T extends string>(key: string, initial: T, valid: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      return valid.includes(saved as T) ? saved as T : initial
    } catch { return initial }
  })
  const save = useCallback((next: T) => {
    setValue(next)
    try { localStorage.setItem(key, next) } catch { /* private browsing */ }
  }, [key])
  return [value, save]
}

export function ClusterApp() {
  const [win, setWin] = useSavedChoice('observatory.monitor.window', '7d' as SpeedWindow, SPEED_WINDOWS)
  const [scope, setScope] = useSavedChoice('observatory.monitor.scope', 'all' as SpeedScope, ['all', 'ours'])
  const [user, setUser] = useState(() => {
    try { return localStorage.getItem('observatory.monitor.user') || '' } catch { return '' }
  })
  const currentUser = useRef(user)
  currentUser.current = user
  const chooseUser = (value: string) => {
    setUser(value)
    try { localStorage.setItem('observatory.monitor.user', value) } catch { /* private browsing */ }
  }
  const [limited, setLimited] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [ov, setOv] = useState<ClusterOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [speed, setSpeed] = useState<QueueSpeedResponse | null>(null)
  const [groups, setGroups] = useState<SeriesResponse | null>(null)
  const [pools, setPools] = useState<SeriesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await clusterApi<ClusterOverview>(user ? `?user=${encodeURIComponent(user)}` : '', { signal })
      if (!signal?.aborted && currentUser.current === user) { setOv(next); setError(null) }
    } catch (e) {
      if (!signal?.aborted && currentUser.current === user) {
        if (e instanceof ClusterApiError && e.status === 422 && user) chooseUser('')
        else setError((e as Error).message)
      }
    }
  }, [user])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const update = () => { if (document.visibilityState === 'visible') void load(controller.signal) }
    const timer = window.setInterval(update, 60_000)
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      controller.abort(); clearInterval(timer); clearInterval(clock)
      document.removeEventListener('visibilitychange', update)
    }
  }, [load])

  const ready = ov !== null
  const tick = ov?.status.lastTickMs
  const synced = ov?.status.sacctSyncedToMs
  const jobRows = ov?.status.jobRows
  const backfillDays = ov?.status.backfill.doneDays
  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    setLoading(true)
    setHistoryError(null)
    const options = { signal: controller.signal }
    void Promise.all([
      clusterApi<QueueSpeedResponse>(`/queue-speed?window=${win}&scope=${scope}&limited=${limited ? 'include' : 'exclude'}`, options),
      clusterApi<SeriesResponse>(`/series?metric=groups&window=${win}`, options),
      clusterApi<SeriesResponse>(`/series?metric=pools&window=${win}`, options),
    ]).then(([s, g, p]) => {
      if (!controller.signal.aborted) { setSpeed(s); setGroups(g); setPools(p) }
    }).catch((e: Error) => {
      if (!controller.signal.aborted) setHistoryError(e.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [ready, win, scope, limited, tick, synced, jobRows, backfillDays])

  const refresh = async () => {
    setRefreshing(true); setRefreshError(null)
    try { await clusterApi('/refresh', { method: 'POST' }); await load() }
    catch (e) { setRefreshError((e as Error).message) }
    finally { setRefreshing(false) }
  }
  const status = ov?.status
  const tz = ov?.serverTimezone ?? ''
  const shownSpeed = speed?.window === win && speed.scope === scope && speed.includeLimited === limited ? speed : null
  const shownGroups = groups?.window === win ? groups : null
  const shownPools = pools?.window === win ? pools : null
  // Only a running collector backfills: a disabled or unreachable one never starts.
  const backfilling = status?.available && status.backfill.doneDays < status.backfill.totalDays
  const stale = ov?.sampleMs != null && now - ov.sampleMs > 15 * 60_000

  const shownOverview = ov?.selectedUser === (user || null) ? ov : null

  return <section className="cluster-shell" aria-label="Skipjack detailed monitor">
    <div className="panel-head"><h2>Skipjack cluster monitor</h2><span className="muted small">Account usage, capacity, and queue history</span></div>
    <div className="toolbar">
      <span className="seg" role="group" aria-label="Time window">
        {SPEED_WINDOWS.map(w => <button key={w} className={win === w ? 'on' : ''} aria-pressed={win === w} onClick={() => setWin(w)}>{w}</button>)}
      </span>
      <label className="user-picker">User perspective
        <select value={user} onChange={event => chooseUser(event.target.value)} aria-label="User perspective">
          <option value="">Account totals</option>
          {user && !ov?.availableUsers.includes(user) && <option value={user}>{user}</option>}
          {ov?.availableUsers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <span className="grow" />
      {status && <span className="muted small" title={`${status.jobRows.toLocaleString()} job records · ${fmtBytes(status.dbBytes)}`}>
        queue {relTime(ov?.sampleMs, now)} · history {relTime(status.sacctSyncedToMs, now)}
      </span>}
      {backfilling && <span className="chip info">backfilling {status.backfill.doneDays}/{status.backfill.totalDays} d</span>}
      <button onClick={() => void refresh()} disabled={refreshing || !status?.available || !shownOverview}>{refreshing ? 'Collecting…' : 'Collect now'}</button>
    </div>
    {error && <div className="banner bad" role="alert">Cluster API unavailable: {error} <button onClick={() => void load()}>Retry</button></div>}
    {status && !status.enabled && <div className="banner info">The cluster monitor is disabled.</div>}
    {status?.error && <div className={`banner ${status.locked ? 'warn' : 'bad'}`} role="alert">{status.error}</div>}
    {stale && <div className="banner warn" role="status">The latest queue sample is {relTime(ov.sampleMs, now)}. Counts reflect that sample.</div>}
    {(historyError || refreshError) && <div className="banner bad" role="alert">{historyError || refreshError}</div>}
    {!ov && !error && <p role="status">Loading cluster data…</p>}
    {ov && <div className="cluster-content">
      {shownOverview && shownOverview.groups.length > 0 && <AccountsPanel groups={shownOverview.groups} serverNowMs={shownOverview.serverNowMs} tz={tz} selectedUser={shownOverview.selectedUser} />}
      {!shownOverview && <p role="status">Loading user perspective…</p>}
      {shownOverview && shownOverview.groups.length === 0 && <p className="muted">No tracked account associations have been collected yet.</p>}
      <QueueSpeedPanel speed={shownSpeed} loading={loading} win={win} now={now} scope={scope} setScope={setScope} limited={limited} setLimited={setLimited} />
      <CapacityPanel capacity={ov.capacity} pools={shownPools} win={win} tz={tz} />
      <TrendsPanel series={shownGroups} groupNames={ov.groups.map(g => g.name)} win={win} tz={tz} />
      <PendingPanel jobs={ov.pendingOurs} now={now} />
      <TopAccountsPanel top={ov.topAccounts} />
    </div>}
  </section>
}
