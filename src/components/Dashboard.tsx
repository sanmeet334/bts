import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCheck,
  Clock,
  Filter,
  Gauge,
  Radio,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { analyticsApi, incidentsApi } from '../services/api';
import {
  AnalyticsOverviewDTO,
  HistoricalAnalyticsDTO,
  HistoricalBucketHours,
  HistoricalCorridorBreakdownDTO,
  HistoricalTimeWindow,
  IncidentDTO,
  LiveIncidentNotificationDTO,
  LiveNotificationEventType,
} from '../shared/types';

export interface DashboardProps {
  overview?: AnalyticsOverviewDTO | null;
  compact?: boolean;
}

interface PublicSummaryState {
  networkSummary: AnalyticsOverviewDTO['networkSummary'];
  verifiedIncidentsCount: number;
  predictionStats: AnalyticsOverviewDTO['predictionStats'];
}

interface CustomTooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
}

function DashboardChartTooltip({
  active,
  payload,
  label,
  unitByKey,
}: {
  active?: boolean;
  payload?: CustomTooltipPayloadEntry[];
  label?: string;
  unitByKey?: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-[#0B111E] px-3 py-2.5 text-xs text-slate-100 shadow-lg space-y-1.5">
      <p className="font-mono text-[11px] font-semibold text-slate-300 border-b border-slate-800 pb-1">
        {label}
      </p>
      <div className="space-y-1">
        {payload.map((entry, idx) => {
          const unit = entry.dataKey && unitByKey?.[entry.dataKey] ? unitByKey[entry.dataKey] : '';
          return (
            <div
              key={`${entry.dataKey || idx}`}
              className="flex items-center justify-between gap-4 font-mono tabular-nums"
            >
              <span className="text-slate-300 flex items-center gap-1.5 font-sans">
                <span
                  className="inline-block w-2 h-2 rounded-sm shrink-0"
                  style={{ backgroundColor: entry.color || '#38BDF8' }}
                />
                {entry.name}
              </span>
              <span className="font-semibold text-white">
                {entry.value}
                {unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const WINDOW_OPTIONS: Array<{ value: HistoricalTimeWindow; label: string }> = [
  { value: '6H', label: 'Last 6H' },
  { value: '12H', label: 'Last 12H' },
  { value: '24H', label: 'Last 24H' },
];

const BUCKET_OPTIONS: Array<{ value: HistoricalBucketHours; label: string }> = [
  { value: 2, label: '2h Intervals' },
  { value: 4, label: '4h Intervals' },
  { value: 6, label: '6h Intervals' },
];

function getCongestionFill(pct: number): string {
  if (pct >= 75) return '#EF4444';
  if (pct >= 55) return '#F97316';
  if (pct >= 35) return '#EAB308';
  return '#22C55E';
}

function getSeverityTextClass(severity: string): string {
  if (severity === 'CRITICAL') return 'text-red-400';
  if (severity === 'HIGH') return 'text-orange-400';
  if (severity === 'MEDIUM') return 'text-amber-300';
  if (severity === 'INFO') return 'text-cyan-300';
  return 'text-emerald-400';
}

function mapIncidentToNotification(
  inc: IncidentDTO,
  event: LiveNotificationEventType,
  timestamp: string,
  isLiveWebSocket: boolean
): LiveIncidentNotificationDTO {
  return {
    notificationId: `${inc.id}-${event}-${timestamp}`,
    dedupeKey: `inc:${inc.id}:${inc.status}`,
    event,
    incidentId: inc.id,
    type: inc.type,
    severity: inc.severity,
    status: inc.status,
    description: inc.description,
    roadSegmentId: inc.roadSegmentId ?? null,
    roadSegmentName: inc.roadSegmentName ?? null,
    latitude: inc.latitude,
    longitude: inc.longitude,
    timestamp,
    isLiveWebSocket,
    isSimulated: true,
    unread: isLiveWebSocket,
  };
}

export function Dashboard({ overview: propOverview = null, compact = false }: DashboardProps) {
  const { user, socket, socketConnected } = useAuth();
  const { pushToast } = useToast();

  const [timeWindow, setTimeWindow] = useState<HistoricalTimeWindow>('24H');
  const [bucketHours, setBucketHours] = useState<HistoricalBucketHours>(2);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>('');

  const [historical, setHistorical] = useState<HistoricalAnalyticsDTO | null>(null);
  const [publicSummary, setPublicSummary] = useState<PublicSummaryState | null>(null);
  const [fetchedOverview, setFetchedOverview] = useState<AnalyticsOverviewDTO | null>(null);

  const [notifications, setNotifications] = useState<LiveIncidentNotificationDTO[]>([]);
  const [toastAlertsEnabled, setToastAlertsEnabled] = useState(true);
  const toastAlertsRef = useRef(toastAlertsEnabled);
  toastAlertsRef.current = toastAlertsEnabled;
  const seenKeysRef = useRef<Set<string>>(new Set());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAccessOverview = Boolean(
    user && ['ADMIN', 'SIGNAL_OPERATOR', 'EMERGENCY_OPERATOR'].includes(user.role)
  );
  const activeOverview = propOverview ?? fetchedOverview;

  const pushUniqueNotification = useCallback(
    (item: LiveIncidentNotificationDTO, notifyToast: boolean) => {
      if (seenKeysRef.current.has(item.dedupeKey)) {
        return;
      }
      seenKeysRef.current.add(item.dedupeKey);
      setNotifications((prev) => [item, ...prev].slice(0, 16));

      if (notifyToast && toastAlertsRef.current) {
        const variant =
          item.severity === 'CRITICAL'
            ? 'error'
            : item.severity === 'HIGH' || item.severity === 'MEDIUM'
            ? 'warning'
            : 'info';
        pushToast({
          variant,
          title: `Live ${item.type} (${item.status})`,
          message: item.roadSegmentName
            ? `${item.roadSegmentName} — ${item.description}`
            : item.description,
        });
      }
    },
    [pushToast]
  );

  const syncRecentIncidents = useCallback(async () => {
    try {
      const list = await incidentsApi.list({ status: 'ALL' });
      const seeded = list
        .slice(0, 6)
        .map((inc) =>
          mapIncidentToNotification(
            inc,
            inc.status === 'RESOLVED'
              ? 'incident:resolved'
              : inc.status === 'VERIFIED'
              ? 'incident:verified'
              : 'incident:reported',
            inc.updatedAt || inc.createdAt,
            false
          )
        );
      setNotifications((prev) => {
        const merged = [...prev];
        for (const item of seeded) {
          if (!seenKeysRef.current.has(item.dedupeKey)) {
            seenKeysRef.current.add(item.dedupeKey);
            merged.push(item);
          }
        }
        return merged
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
          .slice(0, 16);
      });
    } catch {
      // Non-fatal: live WebSocket events continue independently
    }
  }, []);

  const loadAnalytics = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const [histData, pubData] = await Promise.all([
          analyticsApi.getHistorical({
            window: timeWindow,
            bucketHours,
            segmentId: selectedSegmentId || undefined,
          }),
          analyticsApi.getPublicSummary(),
        ]);
        setHistorical(histData);
        setPublicSummary(pubData);

        if (!propOverview && canAccessOverview) {
          try {
            const ov = await analyticsApi.getOverview();
            setFetchedOverview(ov);
          } catch {
            // Keep historical and public summary rendered if role scope changes mid-session
          }
        }
      } catch (err: any) {
        setError(err?.message || 'Unable to load historical traffic analytics.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [timeWindow, bucketHours, selectedSegmentId, propOverview, canAccessOverview]
  );

  useEffect(() => {
    loadAnalytics(false);
  }, [loadAnalytics]);

  useEffect(() => {
    syncRecentIncidents();
  }, [syncRecentIncidents]);

  useEffect(() => {
    if (!socket) return;

    const handleIncidentEvent =
      (eventName: Exclude<LiveNotificationEventType, 'road:status-changed'>, shouldToast: boolean) =>
      (msg: any) => {
        const payload = (msg?.payload ?? msg) as IncidentDTO | undefined;
        const timestamp = msg?.timestamp || payload?.updatedAt || payload?.createdAt || new Date().toISOString();
        if (payload?.id) {
          const item = mapIncidentToNotification(payload, eventName, timestamp, true);
          pushUniqueNotification(item, shouldToast);
        }
        loadAnalytics(true);
      };

    const handleRoadStatusChanged = (msg: any) => {
      const payload = msg?.payload ?? msg ?? {};
      const timestamp = msg?.timestamp || new Date().toISOString();

      // Skip creating a duplicate card when road:status-changed accompanies an incident verification/resolution
      if (payload.simulationId) {
        const ended = payload.status === 'SIMULATION_ENDED';
        const item: LiveIncidentNotificationDTO = {
          notificationId: `${payload.simulationId}-${payload.status}-${timestamp}`,
          dedupeKey: `sim:${payload.simulationId}:${payload.status}`,
          event: 'road:status-changed',
          simulationId: payload.simulationId,
          type: ended ? 'SIMULATION RESTORED' : 'SIMULATION CLOSURE',
          severity: ended ? 'INFO' : 'HIGH',
          status: payload.status || 'SIMULATION_ACTIVE',
          description: ended
            ? `${payload.simulationName || 'Closure scenario'} ended; baseline corridor restored.`
            : `${payload.simulationName || 'Closure scenario'} active (${payload.simulationType || 'CLOSURE'}${
                payload.addedDelayMin ? `, +${payload.addedDelayMin}m detour delay` : ''
              }).`,
          roadSegmentId: payload.segmentId ?? null,
          roadSegmentName: payload.segmentName ?? null,
          timestamp,
          isLiveWebSocket: true,
          isSimulated: true,
          unread: true,
        };
        pushUniqueNotification(item, false);
      } else if (payload.weatherCondition) {
        const item: LiveIncidentNotificationDTO = {
          notificationId: `ctrl-${timestamp}`,
          dedupeKey: `ctrl:${payload.weatherCondition}:${payload.densityMultiplier}:${timestamp.slice(0, 16)}`,
          event: 'road:status-changed',
          type: 'SIMULATION CONTROLS',
          severity: payload.weatherCondition === 'HEAVY_RAIN' ? 'HIGH' : 'MEDIUM',
          status: String(payload.weatherCondition),
          description: `Simulated traffic controls updated: ${payload.weatherCondition}, ${payload.densityMultiplier}x density.`,
          roadSegmentId: null,
          roadSegmentName: 'Network-wide',
          timestamp,
          isLiveWebSocket: true,
          isSimulated: true,
          unread: true,
        };
        pushUniqueNotification(item, false);
      }

      loadAnalytics(true);
    };

    const onPredictionUpdated = () => {
      loadAnalytics(true);
    };

    const onReconnectSync = () => {
      syncRecentIncidents();
      loadAnalytics(true);
    };

    const onIncidentReported = handleIncidentEvent('incident:reported', true);
    const onIncidentCreated = handleIncidentEvent('incident:created', true);
    const onIncidentVerified = handleIncidentEvent('incident:verified', false);
    const onIncidentResolved = handleIncidentEvent('incident:resolved', true);
    const onIncidentUpdated = handleIncidentEvent('incident:updated', false);

    socket.on('connect', onReconnectSync);
    socket.on('incident:reported', onIncidentReported);
    socket.on('incident:created', onIncidentCreated);
    socket.on('incident:verified', onIncidentVerified);
    socket.on('incident:resolved', onIncidentResolved);
    socket.on('incident:updated', onIncidentUpdated);
    socket.on('road:status-changed', handleRoadStatusChanged);
    socket.on('traffic:prediction-updated', onPredictionUpdated);

    return () => {
      socket.off('connect', onReconnectSync);
      socket.off('incident:reported', onIncidentReported);
      socket.off('incident:created', onIncidentCreated);
      socket.off('incident:verified', onIncidentVerified);
      socket.off('incident:resolved', onIncidentResolved);
      socket.off('incident:updated', onIncidentUpdated);
      socket.off('road:status-changed', handleRoadStatusChanged);
      socket.off('traffic:prediction-updated', onPredictionUpdated);
    };
  }, [socket, pushUniqueNotification, syncRecentIncidents, loadAnalytics]);

  const handleSelectCorridor = (segmentId: string) => {
    setSelectedSegmentId((prev) => (prev === segmentId ? '' : segmentId));
  };

  const unreadCount = notifications.filter((n) => n.unread).length;

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => (n.unread ? { ...n, unread: false } : n)));
  };

  const dismissNotification = (notificationId: string) => {
    setNotifications((prev) => prev.filter((n) => n.notificationId !== notificationId));
  };

  const clearFeed = () => {
    setNotifications([]);
  };

  const summary = historical?.summary;
  const series = historical?.series ?? [];
  const topCorridors: HistoricalCorridorBreakdownDTO[] = historical?.topCorridors ?? [];
  const selectedSegmentName =
    historical?.availableSegments.find((s) => s.id === selectedSegmentId)?.name ?? null;

  const corridorChartData = topCorridors.map((c) => ({
    segmentId: c.segmentId,
    shortName: c.segmentName.split(' ').slice(0, 2).join(' '),
    fullName: c.segmentName,
    avgCongestionPct: c.avgCongestionPct,
    avgDelayMin: c.avgDelayMin,
    avgTravelTimeMin: c.avgTravelTimeMin,
    avgSpeedKmh: c.avgSpeedKmh,
  }));

  if (loading && !historical) {
    return (
      <div className="space-y-6" data-testid="historical-dashboard-loading">
        <div className="h-14 rounded-xl border border-slate-800 bg-[#0D1424] animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-slate-800 bg-[#0D1424] animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="h-80 rounded-xl border border-slate-800 bg-[#0D1424] animate-pulse" />
          <div className="h-80 rounded-xl border border-slate-800 bg-[#0D1424] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6" data-testid="historical-analytics-dashboard">
      {/* Toolbar & Interval Controls */}
      <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm sm:text-base font-semibold text-white">
              {compact
                ? 'Historical Congestion & Travel-Time Intervals'
                : 'Aggregated Historical Traffic & Travel-Time Trends'}
            </h2>
            <span className="text-xs font-mono text-cyan-400">
              · SIMULATED HISTORICAL PROFILE
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {selectedSegmentName
              ? `Filtered corridor: ${selectedSegmentName}`
              : 'Network-wide aggregation across 28 Belagavi road segments'}
            {summary?.dataSource ? ` · Source: ${summary.dataSource}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Time Window Selector */}
          <div
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#090E1A] p-1"
            role="group"
            aria-label="Time window"
          >
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTimeWindow(opt.value)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  timeWindow === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Bucket Granularity Selector */}
          <div
            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#090E1A] p-1"
            role="group"
            aria-label="Time interval bucket"
          >
            {BUCKET_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBucketHours(opt.value)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  bucketHours === opt.value
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Corridor Filter */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <select
              aria-label="Filter by corridor"
              value={selectedSegmentId}
              onChange={(e) => setSelectedSegmentId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-1.5 text-xs text-slate-100 max-w-[220px]"
            >
              <option value="">All Corridors (Network Avg)</option>
              {(historical?.availableSegments ?? []).map((seg) => (
                <option key={seg.id} value={seg.id}>
                  {seg.name}
                </option>
              ))}
            </select>
            {selectedSegmentId && (
              <button
                type="button"
                onClick={() => setSelectedSegmentId('')}
                className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Reset
              </button>
            )}
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => loadAnalytics(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/20 px-4 py-3 flex items-center justify-between gap-4 text-xs text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => loadAnalytics(true)}
            className="rounded-md border border-red-500/40 px-3 py-1 text-xs font-medium text-red-100 hover:bg-red-900/40 whitespace-nowrap shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary KPI Row */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Avg Historical Congestion</span>
              {summary.congestionDeltaPct >= 0 ? (
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
              )}
            </div>
            <p className="mt-1.5 text-2xl font-semibold font-mono text-white tabular-nums">
              {summary.avgCongestionPct}%
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-400 tabular-nums">
              Window delta: {summary.congestionDeltaPct >= 0 ? '+' : ''}
              {summary.congestionDeltaPct} pts · Peak{' '}
              {summary.peakBucketLabel ? `${summary.peakBucketLabel} (${summary.peakCongestionPct}%)` : '—'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Avg Corridor Travel Time</span>
              <Clock className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <p className="mt-1.5 text-2xl font-semibold font-mono text-white tabular-nums">
              {summary.avgTravelTimeMin.toFixed(2)} min
            </p>
            <p className="mt-1 text-[11px] font-mono text-amber-300 tabular-nums">
              +{summary.avgDelayMin.toFixed(2)} min avg delay vs free-flow
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Mean Corridor Speed</span>
              <Gauge className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="mt-1.5 text-2xl font-semibold font-mono text-white tabular-nums">
              {summary.avgSpeedKmh.toFixed(1)} km/h
            </p>
            <p className="mt-1 text-[11px] font-mono text-slate-400 tabular-nums">
              {publicSummary
                ? `${publicSummary.networkSummary.openSegments}/${publicSummary.networkSummary.totalSegments} open · ${publicSummary.networkSummary.closedSegments} closed`
                : 'Baseline speed profile'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <p className="text-xs text-slate-400">
              {activeOverview ? 'Operational Impact & Samples' : 'Observations Analyzed'}
            </p>
            <p className="mt-1.5 text-2xl font-semibold font-mono text-white tabular-nums">
              {summary.totalObservations}
            </p>
            <p className="mt-1 text-[11px] font-mono text-cyan-300 tabular-nums">
              {activeOverview
                ? `${activeOverview.signalStats.avgWaitReductionPct}% signal wait saved · ${activeOverview.emergencyStats.avgTimeSavedMin}m EMS saved`
                : publicSummary
                ? `+15m risk ${publicSummary.predictionStats.avg15MinRisk} · ${publicSummary.verifiedIncidentsCount} verified incidents`
                : `${series.length} time intervals`}
            </p>
          </div>
        </div>
      )}

      {/* Live WebSocket Incident & Simulation Notification Feed */}
      <div
        className="rounded-xl border border-slate-800 bg-[#0D1424] overflow-hidden"
        data-testid="live-incident-feed"
      >
        <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Radio
              className={`w-4 h-4 shrink-0 ${
                socketConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <h3 className="text-sm font-semibold text-white">
              Live Traffic Incident Notifications
            </h3>
            <span
              className={`text-[11px] font-mono ${
                socketConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {socketConnected ? 'WS CONNECTED' : 'RECONNECTING'}
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              · SIMULATED NETWORK STREAM
            </span>
            {unreadCount > 0 && (
              <span
                className="text-[11px] font-mono text-cyan-300 tabular-nums"
                data-testid="live-unread-count"
              >
                · {unreadCount} new
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setToastAlertsEnabled((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                toastAlertsEnabled
                  ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-200 hover:bg-cyan-950/50'
                  : 'border-slate-700 bg-[#090E1A] text-slate-400 hover:text-slate-200'
              }`}
            >
              {toastAlertsEnabled ? (
                <Bell className="w-3.5 h-3.5" />
              ) : (
                <BellOff className="w-3.5 h-3.5" />
              )}
              <span>{toastAlertsEnabled ? 'Popups On' : 'Popups Muted'}</span>
            </button>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#090E1A] px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Mark Read</span>
              </button>
            )}

            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearFeed}
                className="rounded-lg border border-slate-700 bg-[#090E1A] px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {notifications.length === 0 ? (
          <div className="px-4 py-5 text-xs text-slate-400">
            Listening on Socket.IO (<span className="font-mono text-slate-300">public:traffic</span>) for real-time simulated traffic incidents and corridor status changes.
          </div>
        ) : (
          <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/70">
            {notifications.map((item) => (
              <div
                key={item.notificationId}
                className={`px-4 py-2.5 flex items-start justify-between gap-3 transition-colors ${
                  item.unread ? 'bg-blue-950/20' : 'hover:bg-slate-800/30'
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-mono font-semibold ${getSeverityTextClass(item.severity)}`}>
                      {item.severity}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="font-semibold text-white">{item.type}</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono text-cyan-300">{item.status}</span>
                    {item.isLiveWebSocket && (
                      <>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-[11px] text-emerald-400">LIVE WS</span>
                      </>
                    )}
                    {item.unread && (
                      <>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-[11px] text-amber-300">NEW</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-200 leading-snug">{item.description}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                    {item.roadSegmentId && item.roadSegmentName ? (
                      <button
                        type="button"
                        onClick={() => handleSelectCorridor(item.roadSegmentId!)}
                        className="text-cyan-400 hover:underline font-sans text-left"
                      >
                        {item.roadSegmentName}
                      </button>
                    ) : (
                      <span className="font-sans">{item.roadSegmentName || 'Network corridor'}</span>
                    )}
                    <span>·</span>
                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.incidentId && (
                    <Link
                      to={`/incidents/${item.incidentId}`}
                      className="rounded-md border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                    >
                      Inspect
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => dismissNotification(item.notificationId)}
                    aria-label="Dismiss incident notification"
                    className="p-1 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty State */}
      {series.length === 0 && !loading ? (
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-8 text-center space-y-3">
          <p className="text-sm font-medium text-white">
            No historical observations matched the selected filter.
          </p>
          <p className="text-xs text-slate-400">
            Expand the time window to 24H or reset the corridor filter to view network trends.
          </p>
          <button
            type="button"
            onClick={() => {
              setTimeWindow('24H');
              setBucketHours(2);
              setSelectedSegmentId('');
            }}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <>
          {/* Primary Charts Grid: Congestion Trend + Travel Time vs Delay */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Chart 1: Congestion Trend & Mean Speed */}
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 flex flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-white">
                  Congestion Trend & Mean Speed Across Intervals
                </h3>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {timeWindow} · {bucketHours}h buckets
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Average vs. peak corridor density (%) alongside mean travel speed (km/h).
              </p>
              <div className="h-72 min-h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={series}
                    margin={{ top: 10, right: 10, left: -12, bottom: 8 }}
                  >
                    <defs>
                      <linearGradient id="traffixCongestionFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38BDF8" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#38BDF8" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      yAxisId="pct"
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                      domain={[0, 100]}
                      unit="%"
                    />
                    <YAxis
                      yAxisId="speed"
                      orientation="right"
                      tick={{ fill: '#34D399', fontSize: 11 }}
                      domain={[0, 70]}
                      unit=" km/h"
                    />
                    <Tooltip
                      content={
                        <DashboardChartTooltip
                          unitByKey={{
                            avgCongestionPct: '%',
                            peakCongestionPct: '%',
                            avgSpeedKmh: ' km/h',
                          }}
                        />
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Area
                      yAxisId="pct"
                      type="monotone"
                      dataKey="avgCongestionPct"
                      name="Avg Congestion"
                      stroke="#38BDF8"
                      strokeWidth={2}
                      fill="url(#traffixCongestionFill)"
                    />
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="peakCongestionPct"
                      name="Peak Corridor"
                      stroke="#F97316"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#F97316' }}
                    />
                    <Line
                      yAxisId="speed"
                      type="monotone"
                      dataKey="avgSpeedKmh"
                      name="Mean Speed"
                      stroke="#34D399"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: '#34D399' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Average Travel Time vs Free-Flow & Congestion Delay */}
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 flex flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-white">
                  Average Travel Time vs. Free-Flow & Delay (min)
                </h3>
                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                  {selectedSegmentName ? 'Selected segment' : 'Per-segment average'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Stacked free-flow baseline + congestion delay vs. total observed travel time.
              </p>
              <div className="h-72 min-h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={series}
                    margin={{ top: 10, right: 12, left: -12, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} unit="m" />
                    <Tooltip
                      content={
                        <DashboardChartTooltip
                          unitByKey={{
                            freeFlowTravelTimeMin: ' min',
                            avgDelayMin: ' min',
                            avgTravelTimeMin: ' min',
                          }}
                        />
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar
                      dataKey="freeFlowTravelTimeMin"
                      name="Free-Flow Baseline"
                      stackId="travel"
                      fill="#334155"
                    />
                    <Bar
                      dataKey="avgDelayMin"
                      name="Congestion Delay"
                      stackId="travel"
                      fill="#F59E0B"
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgTravelTimeMin"
                      name="Total Avg Travel Time"
                      stroke="#60A5FA"
                      strokeWidth={2.2}
                      dot={{ r: 3, fill: '#60A5FA' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Secondary Row: Top Congested Corridors & Interval Data Table */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Chart 3: Top Congested Corridors */}
            <div className="xl:col-span-5 rounded-xl border border-slate-800 bg-[#0D1424] p-5 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-sm font-semibold text-white">
                  Top Historical Congestion Corridors
                </h3>
                {selectedSegmentId && (
                  <button
                    type="button"
                    onClick={() => setSelectedSegmentId('')}
                    className="text-xs text-cyan-400 hover:text-cyan-300 whitespace-nowrap"
                  >
                    Show all corridors
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Click any corridor bar to isolate its time-series intervals.
              </p>
              <div className="h-72 min-h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={corridorChartData}
                    margin={{ top: 8, right: 12, left: -12, bottom: 24 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis
                      dataKey="shortName"
                      tick={{ fill: '#94A3B8', fontSize: 10 }}
                      angle={-18}
                      textAnchor="end"
                    />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip
                      content={
                        <DashboardChartTooltip
                          unitByKey={{
                            avgCongestionPct: '%',
                            avgDelayMin: ' min',
                          }}
                        />
                      }
                    />
                    <Bar
                      dataKey="avgCongestionPct"
                      name="Avg Congestion"
                      radius={[4, 4, 0, 0]}
                      className="cursor-pointer"
                      onClick={(barData: any) => {
                        if (barData?.segmentId) {
                          handleSelectCorridor(barData.segmentId);
                        }
                      }}
                    >
                      {corridorChartData.map((entry) => (
                        <Cell
                          key={entry.segmentId}
                          fill={
                            selectedSegmentId && selectedSegmentId !== entry.segmentId
                              ? '#334155'
                              : getCongestionFill(entry.avgCongestionPct)
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Interval Breakdown Table */}
            <div className="xl:col-span-7 rounded-xl border border-slate-800 bg-[#0D1424] overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Interval Telemetry Breakdown
                  </h3>
                  <p className="text-xs text-slate-400">
                    Aggregated simulated observations per {bucketHours}-hour window
                  </p>
                </div>
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  {series.length} intervals
                </span>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#090E1A] text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="px-4 py-3 font-medium">Interval</th>
                      <th className="px-4 py-3 font-medium text-right">Avg / Peak</th>
                      <th className="px-4 py-3 font-medium text-right">Speed</th>
                      <th className="px-4 py-3 font-medium text-right">Travel / Free</th>
                      <th className="px-4 py-3 font-medium text-right">Delay</th>
                      <th className="px-4 py-3 font-medium text-right">Queue</th>
                      <th className="px-4 py-3 font-medium text-right">Vehicles</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {series.map((row) => (
                      <tr key={row.bucketKey} className="hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 font-mono text-slate-200 whitespace-nowrap">
                          {row.label}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                          <span className="text-cyan-300">{row.avgCongestionPct}%</span>
                          <span className="text-slate-500"> / </span>
                          <span className="text-orange-300">{row.peakCongestionPct}%</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-300">
                          {row.avgSpeedKmh.toFixed(1)} km/h
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                          {row.avgTravelTimeMin.toFixed(2)}m
                          <span className="text-slate-500"> / {row.freeFlowTravelTimeMin.toFixed(2)}m</span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-300">
                          +{row.avgDelayMin.toFixed(2)}m
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">
                          {row.avgQueueLength.toFixed(1)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-400">
                          {row.totalVehicleCount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
