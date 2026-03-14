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
  scratch_space_total_gb: number;
  scratch_space_used_gb: number;
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
  scratch_space_total_gb: number;
  scratch_space_used_gb: number;
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
  scratch_space_total_gb: number;
  scratch_space_used_gb: number;
}

export interface HistoricalDataPoint {
  timestamp: string;
  dsai_team_usage: number;
  dsai_total_usage: number;
  rockfish_team_usage: number;
  rockfish_total_usage: number;
  ia1_active: number;
  ia1_allocated: number;
}