// Wire types are generated from the monitor-only FastAPI contract.
import type { components } from './generated-api'

export type ClusterOverview = components['schemas']['ClusterOverview']
export type ClusterAccountView = components['schemas']['ClusterAccountView']
export type ClusterGroupView = components['schemas']['ClusterGroupView']
export type ClusterPoolView = components['schemas']['ClusterPoolView']
export type QueueSpeedResponse = components['schemas']['QueueSpeedResponse']
export type QueueSpeedRow = components['schemas']['QueueSpeedRow']
export type SeriesResponse = components['schemas']['SeriesResponse']
export type SpeedWindow = QueueSpeedResponse['window']
export type SpeedScope = QueueSpeedResponse['scope']

export const SPEED_WINDOWS = ['24h', '7d', '30d'] as const satisfies readonly SpeedWindow[]
export const GPU_CLASSES = [
  { key: '1', label: '1 GPU' }, { key: '2', label: '2 GPUs' },
  { key: '3-4', label: '3–4 GPUs' }, { key: '5-8', label: '5–8 GPUs' }, { key: '9+', label: '9+ GPUs' },
] as const satisfies readonly { key: QueueSpeedRow['gpuClass']; label: string }[]
export const TL_BUCKETS = [
  { key: '1h', label: '≤1h' }, { key: '4h', label: '1–4h' }, { key: '12h', label: '4–12h' },
  { key: '24h', label: '12–24h' }, { key: 'long', label: '>24h' },
] as const satisfies readonly { key: QueueSpeedRow['tl']; label: string }[]
