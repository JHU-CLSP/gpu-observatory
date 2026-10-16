export const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
export class ClusterApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function clusterApi<T>(suffix = '', options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/stats/skipjack/monitor${suffix}`, { credentials: 'same-origin', ...options })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText
    throw new ClusterApiError(response.status, `${response.status}: ${detail}`)
  }
  return await response.json() as T
}
