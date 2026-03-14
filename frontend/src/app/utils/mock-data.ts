import { DSAIStats, RockfishStats, IA1Stats, HistoricalDataPoint } from "../types/gpu-stats";

export const getMockDSAIStats = (): DSAIStats => ({
  timestamp: new Date().toISOString(),
  server: "dsai",
  partitions: [
    {
      partition: "a100",
      total: 104,
      used: Math.floor(Math.random() * 40) + 60,
      idle: 0,
      down: 16
    },
    {
      partition: "h100",
      total: 52,
      used: Math.floor(Math.random() * 20) + 20,
      idle: 0,
      down: 12
    },
    {
      partition: "nvl",
      total: 64,
      used: Math.floor(Math.random() * 20) + 50,
      idle: 0,
      down: 0
    },
    {
      partition: "l40s",
      total: 56,
      used: Math.floor(Math.random() * 30) + 10,
      idle: 0,
      down: 8
    }
  ].map(p => ({ ...p, idle: p.total - p.used - p.down })),
  partition_totals: {
    total: 276,
    used: 0,
    idle: 0,
    down: 36
  },
  dkhasha1_users: [
    {
      user: "tli104",
      gpus: { a100: Math.floor(Math.random() * 10) + 20 },
      total: 0
    },
    {
      user: "awang116",
      gpus: { a100: Math.floor(Math.random() * 6) + 2 },
      total: 0
    },
    {
      user: "bzhang90",
      gpus: { h100: Math.floor(Math.random() * 4) + 1 },
      total: 0
    },
    {
      user: "ardauzunoglu",
      gpus: { a100: Math.floor(Math.random() * 3) + 1 },
      total: 0
    }
  ].map(u => ({ ...u, total: Object.values(u.gpus).reduce((a, b) => a + b, 0) })),
  dkhasha1_totals: {
    by_partition: {},
    total: 0
  },
  interactive_jobs: [
    {
      jobid: "1151162",
      user: "awang116",
      partition: "a100",
      name: "interactive",
      gpus: 4
    }
  ],
  scratch_space_total_gb: 50000,
  scratch_space_used_gb: Math.floor(Math.random() * 20000) + 25000
});

// Calculate totals
const dsaiStats = getMockDSAIStats();
dsaiStats.partition_totals.used = dsaiStats.partitions.reduce((sum, p) => sum + p.used, 0);
dsaiStats.partition_totals.idle = dsaiStats.partitions.reduce((sum, p) => sum + p.idle, 0);

export const getMockRockfishStats = (): RockfishStats => ({
  timestamp: new Date().toISOString(),
  server: "rockfish",
  partitions: [
    {
      partition: "a100",
      total: 52,
      used: Math.floor(Math.random() * 20) + 10,
      idle: 0,
      down: 12
    },
    {
      partition: "ica100",
      total: 24,
      used: Math.floor(Math.random() * 15) + 5,
      idle: 0,
      down: 16
    },
    {
      partition: "l40s",
      total: 32,
      used: Math.floor(Math.random() * 10),
      idle: 0,
      down: 0
    },
    {
      partition: "v100",
      total: 4,
      used: Math.floor(Math.random() * 3),
      idle: 0,
      down: 0
    }
  ].map(p => ({ ...p, idle: p.total - p.used - p.down })),
  partition_totals: {
    total: 112,
    used: 0,
    idle: 0,
    down: 28
  },
  dkhasha1_users: Math.random() > 0.5 ? [
    {
      user: "tli104",
      gpus: { a100: Math.floor(Math.random() * 4) + 2 },
      total: 0
    }
  ].map(u => ({ ...u, total: Object.values(u.gpus).reduce((a, b) => a + b, 0) })) : [],
  dkhasha1_totals: {
    by_partition: {
      a100: 0,
      ica100: 0,
      l40s: 0,
      v100: 0
    },
    total: 0
  },
  interactive_jobs: [],
  scratch_space_total_gb: 100000,
  scratch_space_used_gb: Math.floor(Math.random() * 30000) + 50000
});

export const getMockIA1Stats = (): IA1Stats => {
  const gpus = Array.from({ length: 10 }, (_, i) => ({
    index: i,
    name: "NVIDIA RTX A6000",
    util_pct: Math.random() > 0.4 ? Math.floor(Math.random() * 100) : 0
  }));

  const users = [
    {
      user: "xwang397",
      processes: 4,
      mem_used_mb: Math.floor(Math.random() * 100000) + 150000,
      gpu_indices: [1, 2, 3, 5]
    },
    {
      user: "zhuang60",
      processes: 2,
      mem_used_mb: Math.floor(Math.random() * 50000) + 80000,
      gpu_indices: [7, 8]
    },
    {
      user: "abyerly2",
      processes: 2,
      mem_used_mb: Math.floor(Math.random() * 30000) + 40000,
      gpu_indices: [0, 6]
    }
  ];

  const idle_allocated_gpus = users.flatMap(user =>
    user.gpu_indices
      .filter(idx => gpus[idx].util_pct === 0)
      .map(idx => ({ gpu: idx, user: user.user }))
  );

  const active_gpus = gpus.filter(g => g.util_pct > 0).length;
  const allocated_gpus = users.reduce((sum, u) => sum + u.gpu_indices.length, 0);

  return {
    timestamp: new Date().toISOString(),
    server: "ia1",
    summary: {
      total_gpus: 10,
      allocated_gpus,
      active_gpus,
      idle_allocated: idle_allocated_gpus.length,
      total_mem_mb: 491400,
      total_mem_used_mb: users.reduce((sum, u) => sum + u.mem_used_mb, 0),
      total_mem_free_mb: 0
    },
    gpus,
    users,
    idle_allocated_gpus,
    scratch_space_total_gb: 10000,
    scratch_space_used_gb: Math.floor(Math.random() * 4000) + 4000
  };
};

export const generateHistoricalData = (hours: number = 24): HistoricalDataPoint[] => {
  const data: HistoricalDataPoint[] = [];
  const now = new Date();
  
  for (let i = hours; i >= 0; i--) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
    data.push({
      timestamp: timestamp.toISOString(),
      dsai_team_usage: Math.floor(Math.random() * 10) + 25,
      dsai_total_usage: Math.floor(Math.random() * 50) + 150,
      rockfish_team_usage: Math.floor(Math.random() * 8),
      rockfish_total_usage: Math.floor(Math.random() * 20) + 20,
      ia1_active: Math.floor(Math.random() * 4) + 3,
      ia1_allocated: Math.floor(Math.random() * 3) + 8
    });
  }
  
  return data;
};