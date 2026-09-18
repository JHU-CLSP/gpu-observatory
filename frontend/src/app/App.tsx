import { useState, useEffect } from "react";
import { SkipjackServerCard } from "./components/SkipjackServerCard";
import { SkipjackAccountUsageChart } from "./components/SkipjackAccountUsageChart";
import { RockfishServerCard } from "./components/RockfishServerCard";
import { IA1ServerCard } from "./components/IA1ServerCard";
import { HistoricalChart } from "./components/HistoricalChart";
import { ThemeToggle } from "./components/ThemeToggle";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { SkipjackStats, RockfishStats, IA1Stats, HistoricalDataPoint } from "./types/gpu-stats";
import { useTheme } from "./hooks/useTheme";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
import { Button } from "./components/ui/button";
import { RefreshCw, Activity, AlertCircle, BarChart2, Info } from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}


export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [skipjackStats, setSkipjackStats] = useState<SkipjackStats | null>(null);
  const [rockfishStats, setRockfishStats] = useState<RockfishStats | null>(null);
  const [ia1Stats, setIa1Stats] = useState<IA1Stats | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [skipjackError, setSkipjackError] = useState<string | null>(null);
  const [rockfishError, setRockfishError] = useState<string | null>(null);
  const [ia1Error, setIa1Error] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const [skipjack, rockfish, ia1, history] = await Promise.all([
        fetch(`${API_BASE}/stats/skipjack`).then(r => r.json()),
        fetch(`${API_BASE}/stats/rockfish`).then(r => r.json()),
        fetch(`${API_BASE}/stats/ia1`).then(r => r.json()),
        fetch(`${API_BASE}/stats/history`).then(r => r.json()),
      ]);

      if (skipjack.error) { setSkipjackError(skipjack.error); setSkipjackStats(null); }
      else { setSkipjackStats(skipjack); setSkipjackError(null); }

      if (rockfish.error) { setRockfishError(rockfish.error); setRockfishStats(null); }
      else { setRockfishStats(rockfish); setRockfishError(null); }

      if (ia1.error) { setIa1Error(ia1.error); setIa1Stats(null); }
      else { setIa1Stats(ia1); setIa1Error(null); }

      setHistoricalData(history);
      setLastUpdate(new Date());
      setFetchError(null);
    } catch (err) {
      setFetchError(`Cannot reach backend at ${API_BASE}. Is uvicorn running?`);
    }
  };

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      await fetch(`${API_BASE}/stats/refresh`, { method: "POST" });
      await fetchStats();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchStats();
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  // Only block the full page on initial load (nothing yet) or backend unreachable
  const nothingLoaded = !skipjackStats && !rockfishStats && !ia1Stats
    && !skipjackError && !rockfishError && !ia1Error;
  if (fetchError || nothingLoaded) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          {fetchError ? (
            <p className="text-red-500 font-medium mb-2">{fetchError}</p>
          ) : (
            <>
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
              <p className="text-muted-foreground">Loading GPU stats...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold">IA Lab GPU Observatory</h1>
                <p className="text-sm text-muted-foreground">
                  Real-time GPU monitoring and analytics
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Last updated</div>
                <div className="text-sm font-medium">
                  {lastUpdate.toLocaleTimeString()}
                </div>
              </div>
              <Button
                onClick={refreshData}
                disabled={isRefreshing}
                variant="outline"
                size="sm"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Stats — active GPU counts, shown first for a quick overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">Skipjack Team Usage</div>
            {skipjackStats ? (
              <>
                <div className="text-3xl font-bold text-indigo-600">
                  {skipjackStats.dkhasha1_totals.total}
                  <span className="text-lg text-muted-foreground"> GPUs</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {skipjackStats.dkhasha1_pending.total_gpus_requested > 0
                    ? `${skipjackStats.dkhasha1_pending.total_gpus_requested} GPUs queued`
                    : "No pending requests"}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-red-500 text-sm mt-1">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">Skipjack Pending Queue</div>
            {skipjackStats ? (
              <>
                <div className="text-3xl font-bold text-indigo-600">
                  {skipjackStats.dkhasha1_pending.job_count}
                  <span className="text-lg text-muted-foreground"> jobs</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {skipjackStats.dkhasha1_pending.total_gpus_requested} GPUs requested
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-red-500 text-sm mt-1">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
              Skipjack Queue Speed
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="cursor-help text-muted-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs space-y-1.5">
                    <p>
                      <strong>Avg wait</strong>: mean time from submit to start, across all jobs (including
                      individual array tasks) that started in the window. A few multi-day outliers can drag
                      this up.
                    </p>
                    <p>
                      <strong>Median wait</strong>: the middle value — more representative of what a typical
                      job actually experiences.
                    </p>
                    <p>
                      <strong>Time between starts</strong>: window duration ÷ number of job-starts (i.e.
                      1 ÷ throughput). Reflects how often <em>some</em> job starts, not any one job's own wait.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {skipjackStats?.throughput ? (
              <>
                <div className="flex items-baseline gap-4">
                  <div>
                    <span className="text-2xl font-bold text-indigo-600">
                      {formatDuration(skipjackStats.throughput.avg_wait_seconds)}
                    </span>
                    <div className="text-xs text-muted-foreground">avg wait</div>
                  </div>
                  <div>
                    <span className="text-2xl font-bold text-indigo-600">
                      {formatDuration(skipjackStats.throughput.avg_interstart_seconds)}
                    </span>
                    <div className="text-xs text-muted-foreground">between starts</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  median wait: {formatDuration(skipjackStats.throughput.median_wait_seconds)} • last{" "}
                  {skipjackStats.throughput.window_hours}h
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-red-500 text-sm mt-1">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">IA1 Active GPUs</div>
            {ia1Stats ? (
              <>
                <div className="text-3xl font-bold text-green-600">
                  {ia1Stats.summary.active_gpus}
                  <span className="text-lg text-muted-foreground"> / 10</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {ia1Stats.summary.idle_allocated > 0 && (
                    <Badge variant="outline" className="text-amber-600 border-amber-600">
                      {ia1Stats.summary.idle_allocated} idle allocated
                    </Badge>
                  )}
                  {ia1Stats.summary.idle_allocated === 0 && "All allocated GPUs active"}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-red-500 text-sm mt-1">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">Rockfish Team Usage</div>
            {rockfishStats ? (
              <>
                <div className="text-3xl font-bold text-blue-600">
                  {rockfishStats.dkhasha1_totals.total}
                  <span className="text-lg text-muted-foreground"> GPUs</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  No limit • {rockfishStats.dkhasha1_totals.total > 0 ? "Active" : "Idle"}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-red-500 text-sm mt-1">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            )}
          </div>
        </div>

        {/* Historical Chart — usage over time, shown near the top for a quick trend overview */}
        <div className="mb-8">
          <HistoricalChart data={historicalData} />
        </div>

        {/* Skipjack Cluster — the primary cluster */}
        <div className="mb-8 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <SkipjackServerCard stats={skipjackStats} error={skipjackError} />
            </div>
            <Card className="w-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-5 w-5 text-indigo-600" />
                  <CardTitle>GPU Usage by Account</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {skipjackStats && skipjackStats.cluster_account_usage.length > 0 ? (
                  <SkipjackAccountUsageChart data={skipjackStats.cluster_account_usage} />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {skipjackStats ? "No account usage data." : "Data unavailable."}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Server Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <IA1ServerCard stats={ia1Stats} error={ia1Error} />
          <RockfishServerCard stats={rockfishStats} error={rockfishError} />
        </div>

        {/* Footer */}
        <footer className="mt-12 text-center text-sm text-muted-foreground">
          <p>
            GPU Observatory • Data refreshes automatically every 30 seconds
          </p>
          <p className="mt-1">
            Backend: {API_BASE}
          </p>
        </footer>
      </main>
    </div>
  );
}
