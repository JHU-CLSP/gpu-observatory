import { DSAIStats } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Server, Users, AlertCircle, HardDrive, Moon, Clock, BarChart2, Activity } from "lucide-react";
import { Progress } from "./ui/progress";
import { PendingReason } from "./PendingReason";
import { AccountUsageChart } from "./AccountUsageChart";

interface DSAIServerCardProps {
  stats: DSAIStats | null;
  error?: string | null;
}

export function DSAIServerCard({ stats, error }: DSAIServerCardProps) {
  if (!stats) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <CardTitle>DSAI Cluster</CardTitle>
            </div>
            <Badge variant="outline">Shared</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="break-all font-mono">{error ?? "Data unavailable"}</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  const teamUsagePercent = (stats.dkhasha1_totals.total / 32) * 100;
  const totalUsagePercent = (stats.partition_totals.used / stats.partition_totals.total) * 100;
  const scratchUsedPercent = stats.scratch_space_total_tb > 0
    ? (stats.scratch_space_used_tb / stats.scratch_space_total_tb) * 100
    : 0;
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>DSAI Cluster</CardTitle>
          </div>
          <Badge variant="outline">Shared</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-6">
        {/* Team Usage Overview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team Usage (32 GPU limit)
            </span>
            <span className="font-bold">
              {stats.dkhasha1_totals.total} / 32 GPUs
            </span>
          </div>
          <Progress value={teamUsagePercent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {teamUsagePercent.toFixed(1)}% of team allocation
          </p>
        </div>

        {/* Total Cluster Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Total Cluster Usage</span>
            <span className="font-bold">
              {stats.partition_totals.used} / {stats.partition_totals.total} GPUs
            </span>
          </div>
          <Progress value={totalUsagePercent} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{totalUsagePercent.toFixed(1)}% utilized</span>
            <span>{stats.partition_totals.down} down</span>
          </div>
        </div>

        {/* Scratch Space */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Scratch <span className="text-xs text-muted-foreground">/scratch/dkhasha1</span>
            </span>
            <span className="font-bold">
              {stats.scratch_space_used_tb} / {stats.scratch_space_total_tb} TB
            </span>
          </div>
          <Progress value={scratchUsedPercent} className="h-2" />
          <p className="text-xs text-muted-foreground">{scratchUsedPercent.toFixed(1)}% utilized</p>
        </div>

        {/* Partition Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">GPU Partitions</h4>
          <div className="grid grid-cols-2 gap-3">
            {stats.partitions.map((partition) => {
              const usedPercent = (partition.used / partition.total) * 100;
              return (
                <div
                  key={partition.partition}
                  className="border rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium uppercase">
                      {partition.partition}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {partition.used}/{partition.total}
                    </span>
                  </div>
                  <Progress value={usedPercent} className="h-1" />
                  {partition.down > 0 && (
                    <div className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertCircle className="h-3 w-3" />
                      {partition.down} down
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Team Members Usage */}
        {stats.dkhasha1_users.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Team Members</h4>
            <div className="space-y-2">
              {stats.dkhasha1_users.map((user) => (
                <div
                  key={user.user}
                  className="flex items-center justify-between text-sm border-b pb-2 last:border-0"
                >
                  <span className="font-mono text-xs">{user.user}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {Object.entries(user.gpus).map(([partition, count]) => (
                        <Badge key={partition} variant="secondary" className="mr-1 text-xs">
                          {partition}: {count}
                        </Badge>
                      ))}
                    </span>
                    <span className="font-bold">{user.total} GPUs</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Running Jobs — memory utilization */}
        {stats.dkhasha1_running_jobs && stats.dkhasha1_running_jobs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              Running Jobs
              <span className="text-xs text-muted-foreground font-normal">GPU memory utilization</span>
            </h4>
            <div className="space-y-1.5">
              {stats.dkhasha1_running_jobs.map((job) => {
                const memPct = job.mem_total_mb && job.mem_total_mb > 0
                  ? (job.mem_used_mb! / job.mem_total_mb) * 100
                  : null;
                return (
                  <div key={job.jobid} className="border rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{job.user}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>{job.partition} · {job.gpus} GPU{job.gpus !== 1 ? "s" : ""}</span>
                        <span className="font-mono">#{job.jobid}</span>
                      </div>
                    </div>
                    {memPct !== null ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Mem</span>
                          <span>
                            {(job.mem_used_mb! / 1024).toFixed(1)} / {(job.mem_total_mb! / 1024).toFixed(0)} GB
                            <span className={`ml-1 font-medium ${memPct < 20 ? "text-red-500" : memPct < 50 ? "text-amber-500" : "text-blue-500"}`}>
                              ({memPct.toFixed(0)}%)
                            </span>
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${memPct < 20 ? "bg-red-400" : memPct < 50 ? "bg-amber-400" : "bg-blue-400"}`}
                            style={{ width: `${memPct}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">mem data not yet available</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Interactive Jobs */}
        {stats.interactive_jobs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-blue-500" />
              Interactive Jobs
            </h4>
            {stats.interactive_jobs.map((job) => (
              <div
                key={job.jobid}
                className="text-xs bg-blue-50 dark:bg-blue-950 p-2 rounded"
              >
                <span className="font-mono">{job.user}</span> - {job.partition} ({job.gpus} GPUs)
              </div>
            ))}
          </div>
        )}

        {/* Pending Queue */}
        {stats.dkhasha1_pending?.job_count > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-500" />
              Pending Queue
              <Badge variant="outline" className="text-purple-600 border-purple-600 text-xs">
                {stats.dkhasha1_pending.job_count} jobs · {stats.dkhasha1_pending.total_gpus_requested} GPUs
              </Badge>
            </h4>
            <div className="text-xs text-muted-foreground bg-muted/40 rounded-md p-3 space-y-2">
              <p>
                <span className="font-semibold text-foreground">Priority:</span>{" "}
                Slurm determined that other jobs had higher scheduling priority. Priority is influenced by fairshare,
                job age (time in queue), job size, and overall demand on the partition. If our account has used a lot
                of resources recently, jobs may temporarily receive lower priority so resources are shared fairly.
              </p>
              <p>
                <span className="font-semibold text-foreground">Scheduler placement:</span>{" "}
                Large requests (e.g. an entire 8×A100 or multiple H100 nodes) require Slurm to find a complete set
                of resources available simultaneously on suitable node(s). Even if GPUs appear free, they may not
                meet all job requirements (GPU type, CPU count, memory, node availability), so a job may remain
                pending until an appropriate placement becomes available.
              </p>
            </div>
            <div className="space-y-1">
              {stats.pending_jobs.map((job) => (
                <div key={job.jobid} className="text-xs bg-purple-50 dark:bg-purple-950/40 p-2 rounded flex items-center justify-between">
                  <span className="font-mono">{job.user}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{job.gpu_type ? `${job.gpus_requested}× ${job.gpu_type}` : `${job.gpus_requested} GPUs`}</span>
                    {job.reason && <PendingReason reason={job.reason} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Idle Allocated GPUs */}
        {stats.idle_allocated_gpus?.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Moon className="h-4 w-4 text-amber-500" />
              Idle Allocated GPUs
              <Badge variant="outline" className="text-amber-600 border-amber-600 text-xs">
                {stats.idle_allocated_gpus.length}
              </Badge>
            </h4>
            <div className="space-y-1">
              {stats.idle_allocated_gpus.map((g, i) => (
                <div key={i} className="text-xs bg-amber-50 dark:bg-amber-950 p-2 rounded space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{g.node} · GPU {g.gpu_index}</span>
                    <span className="text-muted-foreground">{g.users.join(", ")}</span>
                  </div>
                  {g.mem_total_mb && g.mem_total_mb > 0 && (
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <span>{(g.mem_used_mb! / 1024).toFixed(1)} / {(g.mem_total_mb / 1024).toFixed(0)} GB mem held</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </div>{/* end left column */}

        {/* Right column: GPU Usage by Account chart */}
        {stats.cluster_account_usage && stats.cluster_account_usage.length > 0 ? (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-blue-500" />
              GPU Usage by Account
            </h4>
            <AccountUsageChart data={stats.cluster_account_usage} />
          </div>
        ) : <div />}

        </div>{/* end two-col grid */}
      </CardContent>
    </Card>
  );
}