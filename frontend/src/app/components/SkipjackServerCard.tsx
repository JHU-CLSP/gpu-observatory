import { useState } from "react";
import { SkipjackStats } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Server, Users, AlertCircle, Clock } from "lucide-react";
import { Progress } from "./ui/progress";
import { PendingReason } from "./PendingReason";

const TOP_USERS_SHOWN = 3;

interface SkipjackServerCardProps {
  stats: SkipjackStats | null;
  error?: string | null;
}

const TEAM_COLOR = "#3b82f6"; // blue-500
const OTHER_COLOR = "#94a3b8"; // slate-400
const FREE_COLOR = "#22c55e"; // green-500
const DOWN_COLOR = "#f87171"; // red-400

export function SkipjackServerCard({ stats, error }: SkipjackServerCardProps) {
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const toggleExpanded = (partition: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(partition)) next.delete(partition);
      else next.add(partition);
      return next;
    });
  };

  if (!stats) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <CardTitle>Skipjack Cluster</CardTitle>
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

  const totalUsagePercent =
    stats.partition_totals.total > 0
      ? (stats.partition_totals.used / stats.partition_totals.total) * 100
      : 0;

  // Merge running usage (dkhasha1_users) with pending jobs (pending_jobs) per
  // person, so someone with only queued jobs (no running GPUs yet) still shows up.
  const pendingByUser = new Map<string, { count: number; gpus: number }>();
  for (const job of stats.pending_jobs) {
    const cur = pendingByUser.get(job.user) ?? { count: 0, gpus: 0 };
    cur.count += 1;
    cur.gpus += job.gpus_requested;
    pendingByUser.set(job.user, cur);
  }
  const runningByUser = new Map(stats.dkhasha1_users.map((u) => [u.user, u]));
  const allMemberNames = new Set([...runningByUser.keys(), ...pendingByUser.keys()]);
  const teamMembers = Array.from(allMemberNames)
    .map((user) => ({
      user,
      running: runningByUser.get(user) ?? null,
      pending: pendingByUser.get(user) ?? null,
    }))
    .sort(
      (a, b) =>
        (b.running?.total ?? 0) - (a.running?.total ?? 0) ||
        (b.pending?.gpus ?? 0) - (a.pending?.gpus ?? 0)
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>Skipjack Cluster</CardTitle>
          </div>
          <Badge variant="outline">Shared</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Team Usage Overview */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team Usage (dkhasha1)
            </span>
            <span className="font-bold">{stats.dkhasha1_totals.total} GPUs running</span>
          </div>
          {stats.dkhasha1_pending.total_gpus_requested > 0 && (
            <p className="text-xs text-muted-foreground">
              {stats.dkhasha1_pending.total_gpus_requested} GPUs queued across{" "}
              {stats.dkhasha1_pending.job_count} pending jobs
            </p>
          )}
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

        {/* GPU Type Breakdown */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">GPU Types</h4>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: TEAM_COLOR }} />
                team
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: OTHER_COLOR }} />
                other accounts
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: FREE_COLOR }} />
                free
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm inline-block" style={{ backgroundColor: DOWN_COLOR }} />
                down
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {stats.partitions.map((partition) => {
              const teamUsed = stats.dkhasha1_totals.by_partition[partition.partition] ?? 0;
              const otherUsed = Math.max(partition.used - teamUsed, 0);
              // "Other accounts" = every non-dkhasha1 SLURM account with a running
              // job on this GPU type — i.e. other labs/PIs, not necessarily "teams".
              const otherAccounts = stats.cluster_account_usage
                .filter((a) => a.account !== "dkhasha1" && (a.gpus[partition.partition] ?? 0) > 0)
                .map((a) => ({ account: a.account, count: a.gpus[partition.partition], isTeam: false }))
                .sort((a, b) => b.count - a.count);
              // Ranked list of every account (including your own team) using this
              // GPU type, for the "who's the main user" popover.
              const mainUsers = [
                ...(teamUsed > 0 ? [{ account: "dkhasha1", count: teamUsed, isTeam: true }] : []),
                ...otherAccounts,
              ].sort((a, b) => b.count - a.count);
              const segments = [
                { color: TEAM_COLOR, value: teamUsed },
                { color: OTHER_COLOR, value: otherUsed },
                { color: FREE_COLOR, value: partition.idle },
                { color: DOWN_COLOR, value: partition.down },
              ];
              const segmentTotal = partition.total > 0 ? partition.total : 1;
              return (
                <div key={partition.partition} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium uppercase">{partition.partition}</span>
                    <span className="text-xs text-muted-foreground">
                      {partition.used}/{partition.total}
                    </span>
                  </div>
                  <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    {segments.map((seg, i) =>
                      seg.value > 0 ? (
                        <div
                          key={i}
                          style={{
                            width: `${(seg.value / segmentTotal) * 100}%`,
                            backgroundColor: seg.color,
                          }}
                        />
                      ) : null
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{teamUsed > 0 ? `${teamUsed} team` : "no team usage"}</span>
                    {partition.down > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertCircle className="h-3 w-3" />
                        {partition.down} down
                      </span>
                    )}
                  </div>
                  {otherUsed > 0 && otherAccounts.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      {otherUsed} used by other accounts (breakdown unavailable)
                    </p>
                  )}
                  {mainUsers.length > 0 && (() => {
                    const isExpanded = expandedTypes.has(partition.partition);
                    const shown = isExpanded ? mainUsers : mainUsers.slice(0, TOP_USERS_SHOWN);
                    const hiddenCount = mainUsers.length - shown.length;
                    return (
                      <div className="space-y-0.5 pt-1 border-t">
                        <p className="text-xs font-medium text-foreground">Top users</p>
                        {shown.map((u, i) => (
                          <div key={u.account} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="text-muted-foreground shrink-0">{i + 1}.</span>
                              <span className={`truncate ${u.isTeam ? "font-semibold" : ""}`}>{u.account}</span>
                              {u.isTeam && (
                                <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                                  you
                                </Badge>
                              )}
                            </span>
                            <span className="font-mono shrink-0 ml-1">{u.count}</span>
                          </div>
                        ))}
                        {(hiddenCount > 0 || isExpanded) && mainUsers.length > TOP_USERS_SHOWN && (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(partition.partition)}
                            className="text-xs text-primary hover:underline cursor-pointer"
                          >
                            {isExpanded ? "Show less" : `+${hiddenCount} more account${hiddenCount === 1 ? "" : "s"}`}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  <p className="text-xs text-muted-foreground truncate">
                    Access: {partition.allow_accounts ?? "?"}
                    {partition.deny_qos ? ` (excl. ${partition.deny_qos})` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team Members: who's running what, and who's stuck in the queue */}
        {teamMembers.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Team Members</h4>
            <div className="space-y-2">
              {teamMembers.map(({ user, running, pending }) => (
                <div
                  key={user}
                  className="flex items-center justify-between text-sm border-b pb-2 last:border-0 gap-3"
                >
                  <span className="font-mono text-xs shrink-0">{user}</span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {running ? (
                      <>
                        {Object.entries(running.gpus).map(([partition, count]) => (
                          <Badge key={partition} variant="secondary" className="text-xs">
                            {partition}: {count}
                          </Badge>
                        ))}
                        <span className="font-bold text-xs">{running.total} running</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">no running jobs</span>
                    )}
                    {pending && (
                      <Badge variant="outline" className="text-purple-600 border-purple-600 text-xs">
                        {pending.count} queued · {pending.gpus} GPUs
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
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
            <div className="space-y-1">
              {stats.pending_jobs.map((job) => (
                <div
                  key={job.jobid}
                  className="text-xs bg-purple-50 dark:bg-purple-950/40 p-2 rounded flex items-center justify-between"
                >
                  <span className="font-mono">{job.user}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {job.gpu_type ? `${job.gpus_requested}× ${job.gpu_type}` : `${job.gpus_requested} GPUs`}
                    </span>
                    {job.reason && <PendingReason reason={job.reason} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
