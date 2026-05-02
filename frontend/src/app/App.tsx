import { useState, useEffect } from "react";
import { DSAIServerCard } from "./components/DSAIServerCard";
import { H200ServerCard } from "./components/H200ServerCard";
import { B200ServerCard } from "./components/B200ServerCard";
import { RockfishServerCard } from "./components/RockfishServerCard";
import { IA1ServerCard } from "./components/IA1ServerCard";
import { HistoricalChart } from "./components/HistoricalChart";
import { DSAIStats, RockfishStats, IA1Stats, HistoricalDataPoint } from "./types/gpu-stats";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
import { Button } from "./components/ui/button";
import { RefreshCw, Activity, AlertCircle } from "lucide-react";
import { Badge } from "./components/ui/badge";


export default function App() {
  const [dsaiStats, setDsaiStats] = useState<DSAIStats | null>(null);
  const [rockfishStats, setRockfishStats] = useState<RockfishStats | null>(null);
  const [ia1Stats, setIa1Stats] = useState<IA1Stats | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dsaiError, setDsaiError] = useState<string | null>(null);
  const [rockfishError, setRockfishError] = useState<string | null>(null);
  const [ia1Error, setIa1Error] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const [dsai, rockfish, ia1, history] = await Promise.all([
        fetch(`${API_BASE}/stats/dsai`).then(r => r.json()),
        fetch(`${API_BASE}/stats/rockfish`).then(r => r.json()),
        fetch(`${API_BASE}/stats/ia1`).then(r => r.json()),
        fetch(`${API_BASE}/stats/history`).then(r => r.json()),
      ]);

      if (dsai.error) { setDsaiError(dsai.error); setDsaiStats(null); }
      else { setDsaiStats(dsai); setDsaiError(null); }

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
  const nothingLoaded = !dsaiStats && !rockfishStats && !ia1Stats && !dsaiError && !rockfishError && !ia1Error;
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
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">DSAI Team Usage</div>
            {dsaiStats ? (
              <>
                <div className="text-3xl font-bold text-purple-600">
                  {dsaiStats.dkhasha1_totals.total}
                  <span className="text-lg text-muted-foreground"> / 32</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {((dsaiStats.dkhasha1_totals.total / 32) * 100).toFixed(1)}% of allocation
                  {dsaiStats.idle_allocated_gpus?.length > 0 && (
                    <Badge variant="outline" className="ml-2 text-amber-600 border-amber-600">
                      {dsaiStats.idle_allocated_gpus.length} idle allocated
                    </Badge>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1 text-red-500 text-sm mt-1">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">H200 Condo Usage</div>
            {dsaiStats ? (
              <>
                <div className="text-3xl font-bold text-teal-600">
                  {dsaiStats.h200?.team_gpus_used ?? 0}
                  <span className="text-lg text-muted-foreground"> / {dsaiStats.h200?.team_limit ?? 24}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {(((dsaiStats.h200?.team_gpus_used ?? 0) / (dsaiStats.h200?.team_limit ?? 24)) * 100).toFixed(1)}% of condo allocation
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
        </div>

        {/* Historical Chart */}
        <div className="mb-8">
          <HistoricalChart data={historicalData} />
        </div>

        {/* Server Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="lg:col-span-2">
            <DSAIServerCard stats={dsaiStats} error={dsaiError} />
          </div>
          <H200ServerCard stats={dsaiStats} error={dsaiError} />
          <B200ServerCard stats={dsaiStats} error={dsaiError} />
          <RockfishServerCard stats={rockfishStats} error={rockfishError} />
          <IA1ServerCard stats={ia1Stats} error={ia1Error} />
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
