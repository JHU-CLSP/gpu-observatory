import { useState, useEffect } from "react";
import { DSAIServerCard } from "./components/DSAIServerCard";
import { RockfishServerCard } from "./components/RockfishServerCard";
import { IA1ServerCard } from "./components/IA1ServerCard";
import { HistoricalChart } from "./components/HistoricalChart";
import { DSAIStats, RockfishStats, IA1Stats, HistoricalDataPoint } from "./types/gpu-stats";
import { generateHistoricalData } from "./utils/mock-data";

const API_BASE = "http://localhost:8000";
import { Button } from "./components/ui/button";
import { RefreshCw, Activity } from "lucide-react";
import { Badge } from "./components/ui/badge";

export default function App() {
  const [dsaiStats, setDsaiStats] = useState<DSAIStats | null>(null);
  const [rockfishStats, setRockfishStats] = useState<RockfishStats | null>(null);
  const [ia1Stats, setIa1Stats] = useState<IA1Stats | null>(null);
  const [historicalData, setHistoricalData] = useState<HistoricalDataPoint[]>(generateHistoricalData(24));
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const [dsai, rockfish, ia1] = await Promise.all([
        fetch(`${API_BASE}/stats/dsai`).then(r => r.json()),
        fetch(`${API_BASE}/stats/rockfish`).then(r => r.json()),
        fetch(`${API_BASE}/stats/ia1`).then(r => r.json()),
      ]);
      setDsaiStats(dsai);
      setRockfishStats(rockfish);
      setIa1Stats(ia1);
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

  // Update historical data every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setHistoricalData(generateHistoricalData(24));
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  if (!dsaiStats || !rockfishStats || !ia1Stats) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          {fetchError ? (
            <>
              <p className="text-red-500 font-medium mb-2">{fetchError}</p>
              <p className="text-sm text-muted-foreground">Run: <code>uvicorn app:app --reload --port 8000</code></p>
            </>
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">DSAI Team Usage</div>
            <div className="text-3xl font-bold text-purple-600">
              {dsaiStats.dkhasha1_totals.total}
              <span className="text-lg text-muted-foreground"> / 32</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {((dsaiStats.dkhasha1_totals.total / 32) * 100).toFixed(1)}% of allocation
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">Rockfish Team Usage</div>
            <div className="text-3xl font-bold text-blue-600">
              {rockfishStats.dkhasha1_totals.total}
              <span className="text-lg text-muted-foreground"> GPUs</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              No limit • {rockfishStats.dkhasha1_totals.total > 0 ? "Active" : "Idle"}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border">
            <div className="text-sm text-muted-foreground mb-2">IA1 Active GPUs</div>
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
          </div>
        </div>

        {/* Historical Chart */}
        <div className="mb-8">
          <HistoricalChart data={historicalData} />
        </div>

        {/* Server Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          <DSAIServerCard stats={dsaiStats} />
          <RockfishServerCard stats={rockfishStats} />
          <IA1ServerCard stats={ia1Stats} />
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
