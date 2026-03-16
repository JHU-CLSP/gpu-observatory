// Type definitions for GPU statistics

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

export interface H200Stats {
  team_limit: number;
  team_gpus_used: number;
  total_gpus_used: number;
  total_gpus_available: number;
  running_jobs: H200RunningJob[];
  pending_jobs: PendingJob[];
  pending_summary: PendingSummary;
}

export interface DSAIIdleGPU {
  node: string;
  gpu_index: number;
  util_pct: number;
  users: string[];
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
  scratch_space_total_tb: number;
  scratch_space_used_tb: number;
}

export interface RockfishPartition {
  partition: string;
  total: number;
  used: number;
  idle: number;
  down: number;
}

export interface RockfishStats {
  timestamp: string;
  server: "rockfish";
  partitions: RockfishPartition[];
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
  pending_jobs: PendingJob[];
  dkhasha1_pending: PendingSummary;
  scratch_space_total_tb: number;
  scratch_space_used_tb: number;
}

export interface IA1GPU {
  index: number;
  name: string;
  util_pct: number;
}

export interface IA1User {
  user: string;
  processes: number;
  mem_used_mb: number;
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
  dsai_team_usage: number;
  dsai_total_usage: number;
  dsai_pending_gpus: number;
  dsai_h200_team_usage: number;
  rockfish_team_usage: number;
  rockfish_total_usage: number;
  rockfish_pending_gpus: number;
  ia1_active: number;
  ia1_allocated: number;
  ia1_pending_gpus: number;
}