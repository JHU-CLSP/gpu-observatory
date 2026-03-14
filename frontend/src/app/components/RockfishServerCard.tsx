import { RockfishStats } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Server, Users, AlertCircle, HardDrive } from "lucide-react";
import { Progress } from "./ui/progress";

interface RockfishServerCardProps {
  stats: RockfishStats;
}

export function RockfishServerCard({ stats }: RockfishServerCardProps) {
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
            <CardTitle>Rockfish Cluster</CardTitle>
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
              Team Usage
            </span>
            <span className="font-bold">
              {stats.dkhasha1_totals.total} GPUs
            </span>
          </div>
          {stats.dkhasha1_totals.total > 0 && (
            <p className="text-xs text-muted-foreground">
              Currently using {stats.dkhasha1_totals.total} GPU{stats.dkhasha1_totals.total !== 1 ? 's' : ''}
            </p>
          )}
          {stats.dkhasha1_totals.total === 0 && (
            <p className="text-xs text-muted-foreground">
              No active GPUs
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

        {/* Scratch Space */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Scratch <span className="text-xs text-muted-foreground">/scratch4/danielk</span>
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
      </CardContent>
    </Card>
  );
}