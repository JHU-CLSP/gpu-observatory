// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StartEstimatesPanel } from './StartEstimatesPanel'
import type { StartEstimatesResponse } from './types'

let host: HTMLDivElement
let root: Root
let requests: { url: URL; method: string }[]
let failed = false
let data: StartEstimatesResponse

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  requests = []; failed = false
  data = { available: true, error: null, probeUser: 'server-user', accounts: ['account-a', 'account-b'], partitions: ['a100', 'h100'],
    account: 'account-a', partition: 'a100', cpusPerGpu: 8, memoryGibPerGpu: 64, cacheSeconds: 900,
    timeLimitsMinutes: [60, 240, 720, 1440, 2880, 4320], nextTimeLimitsMinutes: [60, 720, 2880],
    checkedAtMs: null, rows: [], probing: false }
  vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit) => {
    const url = new URL(path, 'http://localhost')
    requests.push({ url, method: options.method as string })
    if (options.method === 'POST' && failed) return { ok: false, status: 429, json: async () => ({ detail: 'Try again in a minute' }) }
    if (options.method === 'POST') data = { ...data, checkedAtMs: Date.now(), rows: [
      { gpus: 1, timeLimitMinutes: 60, cpus: 8, memoryGib: 64, checkedAtMs: Date.now(), estimatedStartMs: Date.now() + 3600000, waitSec: 3600, status: 'estimated', output: 'estimate with site warning', exitCode: 0 },
      { gpus: 8, timeLimitMinutes: 1440, cpus: 64, memoryGib: 512, checkedAtMs: Date.now(), estimatedStartMs: null, waitSec: null, status: 'error', output: 'Request cannot be scheduled', exitCode: 1 },
    ] }
    return { ok: true, json: async () => ({ ...data, account: url.searchParams.get('account') || data.account, partition: url.searchParams.get('partition') || data.partition }) }
  }))
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers()
})

const mount = () => act(async () => { root.render(<StartEstimatesPanel now={Date.now()} tz="UTC" />) })
const probe = () => act(async () => { host.querySelector<HTMLButtonElement>('button')!.click() })

it('defaults to eight CPUs and only reads cache until a user requests a probe', async () => {
  await mount()
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Probe CPUs per GPU"]')!.value).toBe('8')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(18)
  expect(host.textContent).toContain('Not probed yet')
  expect(host.textContent).toContain('Next batch: 1h, 12h, 48h')
  expect(requests.every(r => r.method === 'GET')).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(900000) })
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(0)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  const count = requests.length
  await act(async () => { await vi.advanceTimersByTimeAsync(900000) })
  expect(requests).toHaveLength(count)
  await probe()
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(1)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  await act(async () => { await vi.advanceTimersByTimeAsync(900000) })
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(1)
})

it('probes the chosen resources and keeps successful rows when a later check fails', async () => {
  await mount()
  for (const [label, value] of [['Probe account', 'account-b'], ['Probe partition', 'h100'], ['Probe CPUs per GPU', '4'], ['Probe memory per GPU', '32']]) {
    const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  await act(async () => { await vi.advanceTimersByTimeAsync(900000) })
  expect(requests.every(r => r.method === 'GET')).toBe(true)
  await probe()
  const request = requests.find(r => r.method === 'POST')!
  expect(Object.fromEntries(request.url.searchParams)).toEqual({ account: 'account-b', partition: 'h100', cpus_per_gpu: '4', memory_gib_per_gpu: '32' })
  expect(host.textContent).toContain('server-user')
  expect(host.textContent).toContain('Request rejected / failed')
  expect(host.querySelectorAll('tbody tr')).toHaveLength(18)
  expect(host.querySelectorAll('tbody summary')).toHaveLength(2)
  expect(host.querySelectorAll('tbody tr')[1].textContent).toContain('—')
  failed = true
  await probe()
  expect(host.textContent).toContain('Try again in a minute')
  expect(host.querySelectorAll('tbody summary')).toHaveLength(2)
  await act(async () => { root.render(<StartEstimatesPanel now={Date.now() + 900000} tz="UTC" />) })
  expect(host.textContent).toContain('stale')
})
