import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { API_BASE } from './api'

const monitorPath = '/stats/skipjack/monitor'
const MAX_PREVIEW_CHARS = 50_000
type Endpoint = { path: string; method?: 'GET' | 'POST'; description: ReactNode }
type Preview = {
  key: string
  loading: boolean
  status?: number
  statusText?: string
  body?: string
  error?: string
  truncated?: boolean
}

const endpoints: Endpoint[] = [
  {
    path: monitorPath,
    description: <>Account usage, fairshare, GPU pools, pending jobs, and collector status. Add <code>?user=username</code> for a user perspective; choose a name from <code>availableUsers</code> in the response.</>,
  },
  {
    path: `${monitorPath}/queue-speed?window=7d&scope=all&limited=include`,
    description: <>Queue wait and start statistics. Options: <code>window=24h|7d|30d</code>, <code>scope=all|ours</code> (all or tracked accounts), and <code>limited=exclude|include</code> (constrained or held jobs).</>,
  },
  {
    path: `${monitorPath}/series?metric=groups&window=7d`,
    description: <>Account group history. Options: <code>metric=groups|pools</code> and <code>window=24h|7d|30d</code>.</>,
  },
  {
    path: `${monitorPath}/series?metric=pools&window=7d`,
    description: <>GPU pool usage and capacity history.</>,
  },
  {
    path: `${monitorPath}/refresh`,
    method: 'POST',
    description: <>Request a collection cycle, like “Collect now”. New cycles are limited to once per minute; a rate limit returns HTTP 429 with a <code>Retry-After</code> header.</>,
  },
  {
    path: `${monitorPath}/start-estimates`,
    description: <>Cached scheduler start estimates, available probe accounts/partitions, and time limits in the next batch. Optional parameters: <code>account</code>, <code>partition</code>, <code>cpus_per_gpu</code> (default 8), and <code>memory_gib_per_gpu</code> (default 64). Reads never send Slurm requests.</>,
  },
  {
    path: `${monitorPath}/start-estimates`, method: 'POST',
    description: <>Request a batch of nine <code>sbatch --test-only</code> checks as the server’s Slurm user: 1, 4, and 8 GPUs, alternating 1/12/48h and 4/24/72h limits between batches. Accepts the same parameters as GET. Keeps the other half’s results; reuses the latest batch for 15 minutes. Allows one new batch per minute across all settings. No job is submitted.</>,
  },
]

const overviewEndpoints: Endpoint[] = [
  { path: '/stats/skipjack', description: 'Skipjack server data from the Overview collector.' },
  { path: '/stats/dsai', description: 'DSAI server data from the Overview collector.' },
  { path: '/stats/ia1', description: 'IA1 server data from the Overview collector.' },
  { path: '/stats/ia2', description: 'IA2 server data from the Overview collector.' },
  { path: '/stats', description: 'Overview data for all servers in one response.' },
  { path: '/stats/history', description: 'Overview history collected since this server started.' },
]

function EndpointLink({ path }: { path: string }) {
  return <a href={`${API_BASE}${path}`} target="_blank" rel="noopener noreferrer"><code>{API_BASE}{path}</code></a>
}

export function ApiHelp() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const request = useRef<AbortController | null>(null)
  const previewId = useId()
  useEffect(() => () => request.current?.abort(), [])

  const closePreview = () => {
    request.current?.abort()
    request.current = null
    setPreview(null)
  }

  const showPreview = async ({ path, method = 'GET' }: Endpoint) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const key = `${method} ${path}`
    setPreview({ key, loading: true })
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method, credentials: 'same-origin', signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      let body = await response.text()
      try { body = JSON.stringify(JSON.parse(body), null, 2) } catch { /* Show non-JSON errors as plain text. */ }
      if (!controller.signal.aborted) setPreview({
        key, loading: false, status: response.status, statusText: response.statusText,
        body: body.slice(0, MAX_PREVIEW_CHARS), truncated: body.length > MAX_PREVIEW_CHARS,
      })
    } catch (error) {
      if (!controller.signal.aborted) setPreview({ key, loading: false, error: (error as Error).message })
    }
  }

  const renderEndpoint = (endpoint: Endpoint) => {
    const { path, method = 'GET', description } = endpoint
    const key = `${method} ${path}`
    const active = preview?.key === key ? preview : null
    return <div key={key} className="api-endpoint">
      <dt>
        <span className="api-method">{method}</span>
        {method === 'GET' ? <EndpointLink path={path} /> : <code>{API_BASE}{path}</code>}
        <button type="button" onClick={() => void showPreview(endpoint)} disabled={active?.loading}
          aria-expanded={active !== null} aria-controls={active ? previewId : undefined}>
          {method === 'GET' ? 'Preview' : 'Run & preview'}<span className="sr-only"> {method} {path}</span>
        </button>
      </dt>
      <dd>
        {description}
        {active && <div className="api-preview" id={previewId} aria-busy={active.loading}>
          <div className="api-preview-head">
            <span role="status">{active.loading ? 'Requesting…' : active.error ? 'Request failed' : `HTTP ${active.status} ${active.statusText}`}</span>
            <button type="button" onClick={closePreview}>{active.loading ? 'Cancel' : 'Hide preview'}</button>
          </div>
          {active.error && <p className="api-preview-error" role="alert">{active.error}</p>}
          {active.body !== undefined && <pre tabIndex={0} aria-label={`Response for ${key}`}>{active.body || '(empty response)'}</pre>}
          {active.truncated && <p className="api-preview-note">Preview limited to the first {MAX_PREVIEW_CHARS.toLocaleString()} characters.</p>}
        </div>}
      </dd>
    </div>
  }

  return <details className="cluster-api-help" onToggle={event => { if (!event.currentTarget.open) closePreview() }}>
    <summary>API access</summary>
    <div className="api-help-content">
      <p>Use these JSON endpoints in your own scripts, open a link, or preview a response below. One preview is shown at a time. Monitor GET requests read cached data; check the timestamps and collector status for freshness.</p>
      <dl className="api-endpoints">{endpoints.map(renderEndpoint)}</dl>
      <h3>Other server data</h3>
      <p>These endpoints use the separate Overview collectors.</p>
      <dl className="api-endpoints">{overviewEndpoints.map(renderEndpoint)}</dl>
    </div>
  </details>
}
