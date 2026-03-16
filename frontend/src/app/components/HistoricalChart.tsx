import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { HistoricalDataPoint } from "../types/gpu-stats";
import { TrendingUp } from "lucide-react";

interface HistoricalChartProps {
  data: HistoricalDataPoint[];
}

export function HistoricalChart({ data }: HistoricalChartProps) {
  if (data.length === 0) {
    return (
      <div className="space-y-6">
        {["DSAI Cluster", "Rockfish Cluster", "IA1 Node"].map((title) => (
          <Card key={title} className="w-full">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
                <CardTitle>{title} - GPU Usage Over Time</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                Collecting data — first chart point appears after the next backend poll (~30 min)
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const dsaiData = data.map((point) => ({
    time: formatTime(point.timestamp),
    "Team Usage": point.dsai_team_usage,
    "Pending": point.dsai_pending_gpus,
  }));

  const rockfishData = data.map((point) => ({
    time: formatTime(point.timestamp),
    "Team Usage": point.rockfish_team_usage,
    "Pending": point.rockfish_pending_gpus,
  }));

  const ia1Data = data.map((point) => ({
    time: formatTime(point.timestamp),
    "Active": point.ia1_active,
    "Allocated": point.ia1_allocated,
    "Pending": point.ia1_pending_gpus,
  }));

  return (
    <div className="space-y-6">
      {/* DSAI Chart */}
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-600" />
            <CardTitle>DSAI Cluster - GPU Usage Over Time</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dsaiData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis 
                label={{ value: "GPU Count", angle: -90, position: "insideLeft" }}
                tick={{ fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "rgba(255, 255, 255, 0.95)",
                  border: "1px solid #ccc",
                  borderRadius: "8px"
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Team Usage"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Pending"
                stroke="#c4b5fd"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Rockfish Chart */}
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <CardTitle>Rockfish Cluster - GPU Usage Over Time</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={rockfishData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis 
                label={{ value: "GPU Count", angle: -90, position: "insideLeft" }}
                tick={{ fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "rgba(255, 255, 255, 0.95)",
                  border: "1px solid #ccc",
                  borderRadius: "8px"
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Team Usage"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Pending"
                stroke="#93c5fd"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* IA1 Chart */}
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            <CardTitle>IA1 Node - GPU Usage Over Time</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={ia1Data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis 
                label={{ value: "GPU Count", angle: -90, position: "insideLeft" }}
                tick={{ fontSize: 12 }}
                domain={[0, 10]}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: "rgba(255, 255, 255, 0.95)",
                  border: "1px solid #ccc",
                  borderRadius: "8px"
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="Active"
                stroke="#10b981"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Allocated"
                stroke="#6ee7b7"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Pending"
                stroke="#a78bfa"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}