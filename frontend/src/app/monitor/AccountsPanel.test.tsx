// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AccountsPanel } from './AccountsPanel'
import type { BudgetView, ClusterAccountView } from './types'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals()
})

function account(name: string, budget: BudgetView | null): ClusterAccountView {
  return { account: name, group: 'Ben', qos: 'scavenger', member: null, users: 3, capGpus: null, userCapGpus: null,
    run: { gpus: 1, jobs: 1 }, pend: { gpus: 0, jobs: 0, gpusQueue: 0 }, levelFs: .4, levelFsInf: false,
    userFairshare: null, budget, topUsers: [], trend: [], trendEst: [] }
}

it('shows SU budgets with dollars, reserved usage, and the reset day', async () => {
  const resetsAtMs = Date.UTC(2026, 11, 1)
  const accounts = [
    account('scavenger', { unit: 'SU', limit: 180000, used: 2867.6, committed: 500, remaining: 176632.4, resetsAtMs }),
    account('gpu_hours', { unit: 'GPU-hours', limit: 1000, used: 12.5, committed: 0, remaining: 987.5, resetsAtMs: null }),
  ]
  await act(async () => root.render(<AccountsPanel groups={[{ name: 'Ben', runGpus: 2, pendGpus: 0, accounts }]}
    serverNowMs={resetsAtMs - 86400_000 * 26} tz="UTC" selectedUser={null} />))
  const [su, hours] = [...host.querySelectorAll('tbody tr')].map((row) => row.children[4])
  expect(su.textContent).toContain('2,868 / 180,000 SU')
  expect(su.textContent).toContain('$2.87 of $180 · +500 reserved · resets Dec 1')
  expect(su.querySelector('[role=meter]')?.getAttribute('aria-valuenow')).toBe('3367.6')
  expect(su.querySelector('[title]')?.getAttribute('title')).toContain('1 SU = one billing-hour = $0.001')
  expect(hours.textContent).toBe('12.5 / 1,000 GPU-hours')
})
