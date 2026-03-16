import { IA1Stats } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Server, AlertTriangle, Activity, HardDrive, Clock } from "lucide-react";
import { Progress } from "./ui/progress";

interface IA1ServerCardProps {
  stats: IA1Stats;
}

export function IA1ServerCard({ stats }: IA1ServerCardProps) {
  const allocatedPercent = (stats.summary.allocated_gpus / stats.summary.total_gpus) * 100;
  const activePercent = (stats.summary.active_gpus / stats.summary.total_gpus) * 100;
  const memUsedPercent = (stats.summary.total_mem_used_mb / stats.summary.total_mem_mb) * 100;
  const scratchUsedPercent = stats.scratch_space_total_tb > 0
    ? (stats.scratch_space_used_tb / stats.scratch_space_total_tb) * 100
    : 0;
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>IA1 Node</CardTitle>
          </div>
          <Badge variant="default">Exclusive</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* GPU Status Overview */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Allocated GPUs</div>
            <div className="text-2xl font-bold">
              {stats.summary.allocated_gpus} / {stats.summary.total_gpus}
            </div>
            <Progress value={allocatedPercent} className="h-2" />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Active GPUs</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              {stats.summary.active_gpus}
            </div>
            <Progress value={activePercent} className="h-2 bg-green-100" />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Memory Usage</span>
            <span className="font-bold">
              {(stats.summary.total_mem_used_mb / 1024).toFixed(1)} / {(stats.summary.total_mem_mb / 1024).toFixed(1)} GB
            </span>
          </div>
          <Progress value={memUsedPercent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {memUsedPercent.toFixed(1)}% memory utilized
          </p>
        </div>

        {/* Scratch Space */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Scratch <span className="text-xs text-muted-foreground">/scratch</span>
            </span>
            <span className="font-bold">
              {stats.scratch_space_used_tb} / {stats.scratch_space_total_tb} TB
            </span>
          </div>
          <Progress value={scratchUsedPercent} className="h-2" />
          <p className="text-xs text-muted-foreground">{scratchUsedPercent.toFixed(1)}% utilized</p>
        </div>

        {/* Idle Allocated GPUs Warning */}
        {stats.summary.idle_allocated > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="font-semibold text-sm">
                  {stats.summary.idle_allocated} Allocated but Idle GPU{stats.summary.idle_allocated !== 1 ? 's' : ''}
                </div>
                <div className="space-y-1">
                  {stats.idle_allocated_gpus.map((item) => (
                    <div
                      key={item.gpu}
                      className="text-xs flex items-center justify-between bg-white dark:bg-amber-900 rounded px-2 py-1"
                    >
                      <span className="font-mono">GPU {item.gpu}</span>
                      <span className="text-muted-foreground">{item.user}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* GPU Grid */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">GPU Status Grid</h4>
          <div className="grid grid-cols-5 gap-2">
            {stats.gpus.map((gpu) => {
              const isActive = gpu.util_pct > 0;
              const isIdle = stats.idle_allocated_gpus.some(idle => idle.gpu === gpu.index);
              
              return (
                <div
                  key={gpu.index}
                  className={`aspect-square border-2 rounded-lg flex flex-col items-center justify-center p-2 ${
                    isIdle
                      ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
                      : isActive
                      ? "border-green-500 bg-green-50 dark:bg-green-950"
                      : "border-gray-200 bg-gray-50 dark:bg-gray-900"
                  }`}
                  title={`GPU ${gpu.index} - ${gpu.util_pct}% utilization`}
                >
                  <div className="text-xs font-bold">GPU {gpu.index}</div>
                  <div className="text-xs text-muted-foreground">{gpu.util_pct}%</div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border-2 border-green-500 bg-green-50"></div>
              <span>Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border-2 border-amber-400 bg-amber-50"></div>
              <span>Idle (Allocated)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border-2 border-gray-200 bg-gray-50"></div>
              <span>Free</span>
            </div>
          </div>
        </div>

        {/* Pending Queue */}
        {stats.pending_summary?.job_count > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-500" />
              Pending Queue
              <Badge variant="outline" className="text-purple-600 border-purple-600 text-xs">
                {stats.pending_summary.job_count} jobs · {stats.pending_summary.total_gpus_requested} GPUs
              </Badge>
            </h4>
            <div className="space-y-1">
              {stats.pending_summary.by_user.map((u) => (
                <div key={u.user} className="text-xs bg-purple-50 dark:bg-purple-950 p-2 rounded flex items-center justify-between">
                  <span className="font-mono">{u.user}</span>
                  <span className="text-muted-foreground">{u.gpus_requested} GPUs queued</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Breakdown */}
        {stats.users.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Active Users</h4>
            <div className="space-y-2">
              {stats.users.map((user) => {
                const idleGPUs = stats.idle_allocated_gpus
                  .filter((g) => g.user === user.user)
                  .map((g) => g.gpu);
                return (
                  <div
                    key={user.user}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm">{user.user}</span>
                      <div className="flex items-center gap-2">
                        {idleGPUs.length > 0 && (
                          <Badge variant="outline" className="text-amber-600 border-amber-600 text-xs">
                            {idleGPUs.length} idle
                          </Badge>
                        )}
                        <Badge variant="secondary">
                          {user.gpu_indices.length} GPU{user.gpu_indices.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      GPUs: {user.gpu_indices.join(", ")}
                      {idleGPUs.length > 0 && (
                        <span className="text-amber-600 ml-1">(idle: {idleGPUs.join(", ")})</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Memory: {(user.mem_used_mb / 1024).toFixed(2)} GB
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}