import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./monitor/ClusterApp', () => ({ ClusterApp: () => <p>Detailed monitor content</p> }))
vi.mock('./components/HistoricalChart', () => ({ HistoricalChart: () => null }))
vi.mock('./components/IA1ServerCard', () => ({ IA1ServerCard: () => null }))
vi.mock('./components/SkipjackServerCard', () => ({ SkipjackServerCard: () => null }))
vi.mock('./components/SkipjackAccountUsageChart', () => ({ SkipjackAccountUsageChart: () => null }))
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ detail: 'Unavailable' }) })))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it('keeps the detailed tab accessible when the overview API fails', async () => {
  await act(async () => root.render(<App />))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Cannot reach backend')
  const tab = Array.from(host.querySelectorAll('[role="tab"]')).find(el => el.textContent === 'Skipjack details')!
  await act(async () => { tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(host.textContent).toContain('Detailed monitor content')
  expect(localStorage.getItem('observatory.tab')).toBe('skipjack')
})

it('restores the detailed tab without fetching the overview', async () => {
  localStorage.setItem('observatory.tab', 'skipjack')
  await act(async () => root.render(<App />))
  expect(host.textContent).toContain('Detailed monitor content')
  expect(fetch).not.toHaveBeenCalled()
})
