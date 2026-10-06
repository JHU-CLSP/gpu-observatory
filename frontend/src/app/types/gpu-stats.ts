// Type definitions for GPU statistics

export interface SkipjackPartition {
  partition: string;
  total: number;
  used: number;
  idle: number;
  down: number;
  allow_accounts: string | null;
  deny_accounts: string | null;
  allow_qos: string | null;
  deny_qos: string | null;
}

export interface SkipjackAccountUsage {
  account: string;
  gpus: Record<string, number>;
  total: number;
  queue: number;
  /** Individual users within this account, with their per-partition GPU counts. */
  users?: { user: string; gpus: Record<string, number>; total: number }[];
}

export interface SkipjackTeamAccountUsage {
  account: string;
  gpus: Record<string, number>;
  total: number;
  pending_gpus: number;
  /** Hard cluster-enforced cap (e.g. a condo allocation's GrpTRES), if one exists for this account. */
  capacity: number | null;
}

export interface SkipjackFairShareNode {
  account: string;
  /** Nesting depth (0 = direct child of pi-dkhasha1 for team accounts). */
  depth: number;
  raw_shares: string;
  /** This account's share among its siblings (0-1). */
  norm_shares: number | null;
  /** This account's share of its parent's usage (0-1), decayed over a 30-day half-life. */
  effective_usage: number | null;
  /** norm_shares / effective_usage; >1 = under-using its share, <1 = over-using. null when unused. */
  level_fs: number | null;
  /** No recorded usage at all (Slurm reports LevelFS as inf). */
  unused: boolean;
}

export interface SkipjackFairShareAccount extends SkipjackFairShareNode {
  pending_jobs: number;
  /** Median normalized fair-share factor (0-1) of this account's pending jobs, from sprio. */
  pending_fs_factor: number | null;
}

export interface SkipjackFairShare {
  /** PriorityWeightFairShare - fair-share factor is multiplied by this in job priority. */
  weight: number | null;
  pi: SkipjackFairShareNode;
  /** Nearest first, e.g. [csci, en]. */
  ancestors: SkipjackFairShareNode[];
  accounts: SkipjackFairShareAccount[];
  cluster_median_pending_fs_factor: number | null;
}

export interface SkipjackWaitBucket {
  gpu_type: string;
  gpus_requested: number;
  count: number;
  avg_wait_seconds: number;
  median_wait_seconds: number;
}

export interface SkipjackThroughput {
  window_hours: number;
  jobs_started: number;
  /** Mean seconds between submission and start, over the window. Skewed by long-tail outliers; null if no jobs started. */
  avg_wait_seconds: number | null;
  /** Median seconds between submission and start - more representative of a "typical" job than the mean. */
  median_wait_seconds: number | null;
  /** Average seconds between one job starting and the next (window / jobs_started) - i.e. 1/(start rate), expressed as a duration. NOT the same as how long any individual job waited. */
  avg_interstart_seconds: number | null;
  /** Wait-time breakdown by exactly what was requested (GPU type + count), so it's clear whether bigger requests wait longer. */
  by_request_size: SkipjackWaitBucket[];
}

export interface SkipjackStats {
  timestamp: string;
  server: "skipjack";
  partitions: SkipjackPartition[];
  partition_totals: {
    total: number;
    used: number;
    idle: number;
    down: number;
  };
  dkhasha1_accounts: string[];
  team_account_usage: SkipjackTeamAccountUsage[];
  fairshare?: SkipjackFairShare | null;
  dkhasha1_users: DSAIUserGPUs[];
  dkhasha1_totals: {
    by_partition: Record<string, number>;
    total: number;
  };
  pending_jobs: PendingJob[];
  dkhasha1_pending: PendingSummary;
  cluster_account_usage: SkipjackAccountUsage[];
  throughput: SkipjackThroughput;
}

export interface DSAIPartition {
  partition: string;
  total: number;
  used: number;
  idle: number;
  down: number;
}

export interface DSAIUserGPUs {
  user: string;
  gpus: Record<string, number>;
  total: number;
  /** GPU count by SLURM account (e.g. sub-accounts like "dkhasha1_main_a"). */
  by_account?: Record<string, number>;
}

export interface DSAIInteractiveJob {
  jobid: string;
  user: string;
  partition: string;
  name: string;
  gpus: number;
}

export interface PendingJob {
  jobid: string;
  user: string;
  partition: string;
  gpus_requested: number;
  gpu_type?: string;
  reason?: string;
  /** UTC ISO-8601 timestamp of when the job was submitted, if known. */
  queued_at?: string | null;
  /** UTC ISO-8601 timestamp of Slurm's scheduled/estimated start time, if known. */
  scheduled_start?: string | null;
  /** SLURM account the job was submitted under (e.g. "dkhasha1_main_a"). */
  account?: string;
  /** Raw Slurm scheduling priority (higher runs sooner), if known. */
  priority?: number | null;
}

export interface PendingSummary {
  job_count: number;
  total_gpus_requested: number;
  by_user: { user: string; gpus_requested: number }[];
}

export interface H200RunningJob {
  jobid: string;
  user: string;
  account: string;
  gpus: number;
}

export interface H200PendingJob {
  jobid: string;
  user: string;
  gpus_requested: number;
  reason: string;
}

export interface H200Node {
  node: string;
  state: string;
}

export interface H200Stats {
  team_limit: number;
  team_gpus_used: number;
  total_gpus_used: number;
  total_gpus_available: number;
  nodes: H200Node[];
  running_jobs: H200RunningJob[];
  pending_jobs: H200PendingJob[];
  pending_summary: PendingSummary;
}

export interface DSAIIdleGPU {
  node: string;
  gpu_index: number;
  util_pct: number;
  users: string[];
}

export interface DSAIAccountUsage {
  account: string;
  gpus: Record<string, number>;
  total: number;
  queue: number;
}

export interface B200Stats {
  team_gpus_used: number;
  total_gpus_used: number;
  total_gpus_available: number;
  nodes: H200Node[];
  running_jobs: H200RunningJob[];
  pending_jobs: H200PendingJob[];
  pending_summary: PendingSummary;
}

export interface DSAIStats {
  timestamp: string;
  server: "dsai";
  partitions: DSAIPartition[];
  partition_totals: {
    total: number;
    used: number;
    idle: number;
    down: number;
  };
  dkhasha1_users: DSAIUserGPUs[];
  dkhasha1_totals: {
    by_partition: Record<string, number>;
    total: number;
  };
  interactive_jobs: DSAIInteractiveJob[];
  idle_allocated_gpus: DSAIIdleGPU[];
  pending_jobs: PendingJob[];
  dkhasha1_pending: PendingSummary;
  h200?: H200Stats;
  b200?: B200Stats;
  cluster_account_usage?: DSAIAccountUsage[];
  scratch_space_total_tb: number;
  scratch_space_used_tb: number;
}

export interface IA1GPU {
  index: number;
  name: string;
  util_pct: number;
  mem_used_mb: number;
  mem_total_mb: number;
}

export interface IA1User {
  user: string;
  processes: number;
  mem_used_mb: number;
  mem_total_mb: number;
  gpu_indices: number[];
}

export interface IA1IdleGPU {
  gpu: number;
  user: string;
}

export interface IA1Stats {
  timestamp: string;
  server: "ia1";
  summary: {
    total_gpus: number;
    allocated_gpus: number;
    active_gpus: number;
    idle_allocated: number;
    total_mem_mb: number;
    total_mem_used_mb: number;
    total_mem_free_mb: number;
  };
  gpus: IA1GPU[];
  users: IA1User[];
  idle_allocated_gpus: IA1IdleGPU[];
  pending_jobs: PendingJob[];
  pending_summary: PendingSummary;
  scratch_space_total_tb: number;
  scratch_space_used_tb: number;
}

export interface HistoricalDataPoint {
  timestamp: string;
  skipjack_team_usage: number;
  skipjack_total_usage: number;
  skipjack_pending_gpus: number;
  skipjack_avg_wait_seconds: number | null;
  skipjack_median_wait_seconds: number | null;
  skipjack_avg_interstart_seconds: number | null;
  dsai_team_usage: number;
  dsai_total_usage: number;
  dsai_pending_gpus: number;
  dsai_h200_team_usage: number;
  dsai_h200_total_usage: number;
  ia1_active: number;
  ia1_allocated: number;
  ia1_pending_gpus: number;
}