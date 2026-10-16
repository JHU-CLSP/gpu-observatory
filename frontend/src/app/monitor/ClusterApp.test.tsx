// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClusterApp } from './ClusterApp'
import type { ClusterOverview, QueueSpeedResponse, SeriesResponse } from './types'

function overview(): ClusterOverview {
  const now = Date.now()
  return {
    availableUsers: ["viewer", "other"], selectedUser: null,
    status: { enabled: true, available: true, locked: false, error: null, lastTickMs: now, lastSacctMs: now,
      sacctSyncedToMs: now, backfill: { doneDays: 14, totalDays: 14 }, jobRows: 10, dbBytes: 1024, accounts: 1 },
    groups: [{ name: 'Ben', runGpus: 2, pendGpus: 1, accounts: [{ account: 'test_account', group: 'Ben', qos: 'jhu2',
      member: null, users: 1, capGpus: 32, userCapGpus: 32, run: { gpus: 2, jobs: 1 },
      pend: { gpus: 1, jobs: 1, gpusQueue: 1 }, levelFs: .4, levelFsInf: false, userFairshare: null,
      budget: null, topUsers: [{ user: 'viewer', runGpus: 2, pendGpus: 1, fairshare: .165 }], trend: [null, 2], trendEst: [false, false] }] }],
    pendingOurs: [{ jobId: '11', account: 'test_account', user: 'viewer', partitions: ['a100'], gpus: 1,
      timeLimitSec: 3600, eligibleMs: now - 3600_000, reason: 'Priority', limited: false, estStartMs: null, priority: 3000 }],
    capacity: [{ pool: 'a100', total: 8, used: 2, idle: 6, planned: 0, down: 0, reserved: 0, pendGpusQueue: 1,
      lanes: [{ partition: 'a100', hidden: false, tier: 1 }], preempted24h: 0, preempted7d: 0, preemptedOurs7d: 0 }],
    topAccounts: [{ account: 'test_account', runGpus: 2, pendGpus: 1, ours: true }],
    sampleMs: now, serverNowMs: now, serverTimezone: 'UTC',
  }
}

let host: HTMLDivElement
let root: Root
let snapshot: ClusterOverview
let failOverview = false
let refreshStatus = 200
let requests: string[]

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  snapshot = overview()
  failOverview = false
  refreshStatus = 200
  requests = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    expect(options?.credentials).toBe('same-origin')
    requests.push(input)
    if (input === '/stats/skipjack/monitor' && failOverview) throw new Error('offline')
    const url = new URL(input, 'http://localhost')
    let data: unknown = { ...snapshot, selectedUser: url.searchParams.get('user'), groups: snapshot.groups.map(group => ({
      ...group, accounts: group.accounts.map(account => ({ ...account,
        member: url.searchParams.has('user') ? url.searchParams.get('user') === 'viewer' : null,
        userFairshare: url.searchParams.get('user') === 'viewer' ? .165 : null,
      })),
    })) }
    let status = 200
    if (url.pathname.endsWith('/queue-speed')) {
      data = { window: url.searchParams.get('window'), scope: url.searchParams.get('scope'),
        includeLimited: url.searchParams.get('limited') === 'include', partitions: ['a100'], rows: [{
          partition: 'a100', gpuClass: '1', tl: '1h', n: 10, events: 10, censored: 0, p50Sec: 300, p90Sec: 540,
          atLeastSec: 600, immediateFrac: 0, pendingNow: { n: 1, medianAgeSec: 3600, oldestAgeSec: 3600 },
        }], generatedAtMs: Date.now(), sacctSyncedToMs: Date.now() } satisfies Omit<QueueSpeedResponse, 'window' | 'scope'> & { window: string | null; scope: string | null }
    } else if (url.pathname.endsWith('/series')) {
      data = { metric: url.searchParams.get('metric'), window: url.searchParams.get('window'), stepSec: 900,
        t: [Date.now() - 900_000, Date.now()], series: [{ name: url.searchParams.get('metric') === 'pools' ? 'a100' : 'Ben running', values: [1, 2] }],
        totals: {}, estimated: [false, false] } satisfies Omit<SeriesResponse, 'window' | 'metric'> & { window: string | null; metric: string | null }
    } else if (url.pathname.endsWith('/refresh')) {
      status = refreshStatus
      data = status === 200 ? { ok: true } : { detail: 'Cluster refresh is limited to once a minute' }
    }
    if (url.searchParams.has('user') && !snapshot.availableUsers.includes(url.searchParams.get('user')!)) {
      status = 422; data = { detail: 'Selected user is not in the cached tracked account associations' }
    }
    return { ok: status === 200, status, statusText: '', json: async () => data } as Response
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const mount = () => act(async () => { root.render(<ClusterApp />) })
async function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)
  expect(button, label).toBeTruthy()
  await act(async () => button!.click())
}

describe('standalone cluster monitor', () => {
  it('renders the ported panels, loads its own API, and exposes chart tables', async () => {
    await mount()
    expect(host.textContent).toContain('Skipjack cluster monitor')
    for (const title of ['Accounts', 'Queue speed by request size', 'GPU pools', 'Usage over time', 'Pending jobs on tracked accounts']) {
      expect(host.textContent).toContain(title)
    }
    expect(host.textContent).toContain('L 0.400')
    expect(requests.every(path => path.startsWith('/stats/skipjack/monitor'))).toBe(true)
    await click('Table')
    expect(host.querySelector('.cluster-trends table')).toBeTruthy()
  })

  it('changes window and scope, and persists only monitor choices', async () => {
    await mount()
    await click('24h')
    await click('Tracked accounts')
    expect(requests).toContain('/stats/skipjack/monitor/queue-speed?window=24h&scope=ours&limited=exclude')
    expect(localStorage.getItem('observatory.monitor.window')).toBe('24h')
    expect(localStorage.getItem('observatory.monitor.scope')).toBe('ours')
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    expect(requests).toContain('/stats/skipjack/monitor/queue-speed?window=24h&scope=ours&limited=include')
  })

  it('retains successful data when polling fails and recovers on retry', async () => {
    await mount()
    failOverview = true
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(host.textContent).toContain('Cluster API unavailable: offline')
    expect(host.textContent).toContain('test_account')
    failOverview = false
    await click('Retry')
    expect(host.textContent).not.toContain('Cluster API unavailable')
  })

  it('reports a backfill only while its collector runs', async () => {
    // The Phase 3 verification of 21a4fac: with the collector off, the
    // fixture's /cluster read "backfilling 0/14 d" beside "The cluster
    // monitor is disabled." Only a running (available) monitor backfills.
    snapshot.status = { ...snapshot.status, enabled: false, available: false, backfill: { doneDays: 0, totalDays: 14 } }
    await mount()
    expect(host.textContent).toContain('The cluster monitor is disabled.')
    expect(host.textContent).not.toContain('backfilling')
  })

  it('reports no backfill when Slurm is out of reach, and its progress while it runs', async () => {
    snapshot.status = { ...snapshot.status, available: false, error: 'Slurm commands unavailable: sacct',
      backfill: { doneDays: 3, totalDays: 14 } }
    await mount()
    expect(host.textContent).toContain('Slurm commands unavailable: sacct')
    expect(host.textContent).not.toContain('backfilling')
    snapshot.status = { ...snapshot.status, available: true, error: null }
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(host.querySelector('.chip.info')?.textContent).toBe('backfilling 3/14 d')
  })

  it('shows unavailable and stale data, and reports refresh limits', async () => {
    snapshot.status.error = 'squeue: temporarily unavailable'
    snapshot.sampleMs = Date.now() - 20 * 60_000
    await mount()
    expect(host.textContent).toContain('squeue: temporarily unavailable')
    expect(host.textContent).toContain('Counts reflect that sample')
    refreshStatus = 429
    await click('Collect now')
    expect(host.textContent).toContain('Cluster refresh is limited to once a minute')
  })
})

it('selects a user without changing account totals or collection settings', async () => {
  await mount()
  expect(host.textContent).not.toContain('best FS')
  const select = host.querySelector('select')!
  await act(async () => { select.value = 'viewer'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(requests).toContain('/stats/skipjack/monitor?user=viewer')
  expect(host.textContent).toContain('viewer FS')
  expect(host.textContent).toContain('0.165')
  expect(localStorage.getItem('observatory.monitor.user')).toBe('viewer')
  await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.textContent).toContain('Account FS')
  expect(host.textContent).not.toContain('best FS')
})

it('recovers when a saved user is no longer in the tracked accounts', async () => {
  localStorage.setItem('observatory.monitor.user', 'removed')
  await mount()
  expect(requests).toContain('/stats/skipjack/monitor?user=removed')
  expect(requests).toContain('/stats/skipjack/monitor')
  expect(host.querySelector('select')?.value).toBe('')
  expect(host.textContent).toContain('Account FS')
})
