import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { ArrowRight, Play } from 'lucide-react';
import { WorkspaceLayout } from '../components/Layout';
import { TrafficMap } from '../components/TrafficMap';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { predictionsApi, routesApi } from '../services/api';
import { RoadNodeDTO, RoadSegmentDTO, TrafficPredictionDTO } from '../shared/types';

export function PredictionsPage() {
  const { user, socket } = useAuth();
  const { pushToast } = useToast();

  const [nodes, setNodes] = useState<RoadNodeDTO[]>([]);
  const [segments, setSegments] = useState<RoadSegmentDTO[]>([]);
  const [predictions, setPredictions] = useState<TrafficPredictionDTO[]>([]);
  const [modelInfo, setModelInfo] = useState<any>(null);
  const [horizon, setHorizon] = useState<15 | 30>(15);
  const [weatherCondition, setWeatherCondition] = useState<'CLEAR' | 'RAIN' | 'HEAVY_RAIN'>(
    'CLEAR'
  );
  const [densityMultiplier, setDensityMultiplier] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [net, predRes] = await Promise.all([
        routesApi.getNetwork(),
        predictionsApi.getLatest({ horizon }),
      ]);
      setNodes(net.nodes);
      setSegments(net.segments);
      setPredictions(predRes.predictions);
      setModelInfo(predRes.modelInfo);
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Failed to Load Predictions', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [horizon, pushToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = () => loadData();
    socket.on('traffic:prediction-updated', onUpdate);
    socket.on('road:status-changed', onUpdate);
    return () => {
      socket.off('traffic:prediction-updated', onUpdate);
      socket.off('road:status-changed', onUpdate);
    };
  }, [socket, loadData]);

  const handleRunPipeline = async () => {
    setRunning(true);
    try {
      const res = await predictionsApi.runPipeline({
        weatherCondition,
        densityMultiplier,
      });
      await loadData();
      pushToast({
        variant: 'success',
        title: 'Forecast Pipeline Completed',
        message: `${res.predictions.length} forecasts stored · MAE=${res.mae}, RMSE=${res.rmse}`,
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Pipeline Error', message: err.message });
    } finally {
      setRunning(false);
    }
  };

  const canRun = user && ['ADMIN', 'SIGNAL_OPERATOR'].includes(user.role);
  const highRiskCount = predictions.filter((p) => p.riskLevel === 'HIGH').length;
  const mediumRiskCount = predictions.filter((p) => p.riskLevel === 'MEDIUM').length;
  const lowRiskCount = predictions.filter((p) => p.riskLevel === 'LOW').length;
  const proactiveRecommendations = predictions
    .filter((p) => (p.riskLevel === 'HIGH' || p.riskLevel === 'MEDIUM') && p.recommendedAlternative)
    .slice(0, 6);

  const chartData = predictions.slice(0, 10).map((p) => ({
    name: p.segmentName.split(' ').slice(0, 2).join(' '),
    Current: Math.round(p.currentDensity * 100),
    Predicted: Math.round(p.predictedDensity * 100),
    Risk: p.riskScore,
  }));

  return (
    <WorkspaceLayout
      title="15–30 Minute Congestion Prediction (Simulated Baseline)"
      breadcrumb="Predictions"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-[#0D1424] border border-slate-800 p-1">
            <button
              type="button"
              onClick={() => setHorizon(15)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                horizon === 15 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              +15 min
            </button>
            <button
              type="button"
              onClick={() => setHorizon(30)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                horizon === 30 ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              +30 min
            </button>
          </div>
          {canRun && (
            <button
              type="button"
              onClick={handleRunPipeline}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{running ? 'Running...' : 'Run Pipeline'}</span>
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Provenance & Model Evaluation Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <p className="text-xs text-slate-400">Model Version</p>
            <p className="mt-1.5 text-sm font-mono text-white truncate">
              {modelInfo?.modelVersion || '—'}
            </p>
            <p className="mt-1 text-[11px] text-cyan-400">SIMULATED HISTORICAL BASELINE</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <p className="text-xs text-slate-400">Chronological Test MAE</p>
            <p className="mt-1.5 text-xl font-semibold font-mono text-white tabular-nums">
              {modelInfo?.maeEstimate ?? '—'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">80/20 temporal split</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <p className="text-xs text-slate-400">Chronological Test RMSE</p>
            <p className="mt-1.5 text-xl font-semibold font-mono text-white tabular-nums">
              {modelInfo?.rmseEstimate ?? '—'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">Density error scale (0–1)</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
            <p className="text-xs text-slate-400">Congestion Risk Tiers (+{horizon}m)</p>
            <p className="mt-1.5 text-sm font-mono tabular-nums text-white">
              <span className="text-red-400">{highRiskCount} HIGH</span>
              <span className="text-slate-600"> · </span>
              <span className="text-amber-300">{mediumRiskCount} MEDIUM</span>
              <span className="text-slate-600"> · </span>
              <span className="text-emerald-400">{lowRiskCount} LOW</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {modelInfo?.dataSource || 'SIMULATED_HISTORICAL_OBSERVATIONS'}
            </p>
          </div>
        </div>

        {/* Simulation Feature Controls (Operator/Admin) */}
        {canRun && (
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-slate-300 mb-1">
                Simulated Weather Input
              </label>
              <select
                value={weatherCondition}
                onChange={(e) => setWeatherCondition(e.target.value as any)}
                className="rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-white"
              >
                <option value="CLEAR">Clear Skies</option>
                <option value="RAIN">Moderate Rain (+8% load)</option>
                <option value="HEAVY_RAIN">Heavy Monsoon Rain (+16% load)</option>
              </select>
            </div>
            <div className="w-56">
              <label className="flex justify-between text-xs text-slate-300 mb-1">
                <span>Simulated Density Multiplier</span>
                <span className="font-mono">{densityMultiplier.toFixed(2)}x</span>
              </label>
              <input
                type="range"
                min="0.6"
                max="1.5"
                step="0.05"
                value={densityMultiplier}
                onChange={(e) => setDensityMultiplier(Number(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>
            <button
              type="button"
              onClick={handleRunPipeline}
              disabled={running}
              className="rounded-lg border border-blue-500/40 bg-blue-600/20 px-4 py-2 text-xs font-medium text-blue-200 hover:bg-blue-600/35"
            >
              Recalculate Simulated Forecasts
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Risk Map */}
          <div className="xl:col-span-6">
            <TrafficMap
              nodes={nodes}
              segments={segments}
              predictions={predictions}
              predictionMode={true}
              heightClass="h-[420px]"
            />
          </div>

          {/* Forecast Chart */}
          <div className="xl:col-span-6 rounded-xl border border-slate-800 bg-[#0D1424] p-5 flex flex-col">
            <h3 className="text-sm font-semibold text-white mb-1">
              Current vs +{horizon}-Minute Predicted Load (%) — Top 10 Risk Corridors
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              SIMULATED DATA · Values derived from historical profile regression + active incidents.
            </p>
            <div className="flex-1 min-h-[340px]">
              {loading ? (
                <div className="h-full flex items-center justify-center text-sm text-slate-400">
                  Loading forecast chart...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} angle={-15} textAnchor="end" />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        borderColor: '#334155',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="Current" fill="#64748B" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Predicted" fill="#38BDF8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Proactive Pre-Congestion Route Recommendations */}
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Proactive Pre-Congestion Route Recommendations (+{horizon} min)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                SIMULATED GRAPH BYPASS · Computed before forecasted bottlenecks peak using capacity, weather, and incident load.
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-300 tabular-nums">
              {proactiveRecommendations.length} bypass alerts
            </span>
          </div>
          {proactiveRecommendations.length === 0 ? (
            <div className="px-5 py-4 text-xs text-emerald-300">
              All corridors are currently forecasted at LOW congestion risk for the +{horizon}-minute horizon.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {proactiveRecommendations.map((p) => {
                const alt = p.recommendedAlternative!;
                return (
                  <div
                    key={`rec-${p.id}`}
                    className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-mono font-semibold ${
                            p.riskLevel === 'HIGH' ? 'text-red-400' : 'text-amber-300'
                          }`}
                        >
                          {p.riskLevel} RISK
                        </span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="font-medium text-white">{p.segmentName}</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="font-mono text-cyan-300 tabular-nums">
                          Forecast {Math.round(p.predictedDensity * 100)}% load ({p.predictedSpeedKmh} km/h)
                        </span>
                      </div>
                      <p className="text-slate-300">
                        Diversion: <span className="text-white font-medium">{alt.detourSegmentNames.join(' → ')}</span>
                      </p>
                      <p className="text-slate-400 font-mono text-[11px] tabular-nums">
                        Bypass {alt.detourDistanceKm} km · Est. {alt.detourEtaMin} min (vs direct congested {alt.directSegmentTimeMin} min)
                      </p>
                    </div>
                    <Link
                      to={`/navigate?originNodeId=${encodeURIComponent(alt.originNodeId)}&destinationNodeId=${encodeURIComponent(alt.destinationNodeId)}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-600/15 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-600/30 whitespace-nowrap shrink-0 self-start lg:self-center"
                    >
                      <span>Open Bypass Route</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Segment Predictions Table */}
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Segment Forecast Table (+{horizon} min)
            </h3>
            <span className="text-xs font-mono text-slate-400">
              {predictions.length} segments · SIMULATED DATA
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090E1A] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Road Segment</th>
                  <th className="px-4 py-3 font-medium text-right">Current Load</th>
                  <th className="px-4 py-3 font-medium text-right">Predicted Load</th>
                  <th className="px-4 py-3 font-medium text-right">Est. Speed</th>
                  <th className="px-4 py-3 font-medium">Risk Level</th>
                  <th className="px-4 py-3 font-medium">Class</th>
                  <th className="px-4 py-3 font-medium text-right">Risk Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {predictions.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 text-slate-200 font-medium">{p.segmentName}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">
                      {Math.round(p.currentDensity * 100)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-cyan-300">
                      {Math.round(p.predictedDensity * 100)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-300">
                      {p.predictedSpeedKmh} km/h
                    </td>
                    <td className="px-4 py-2.5 font-mono font-semibold">
                      <span
                        className={
                          p.riskLevel === 'HIGH'
                            ? 'text-red-400'
                            : p.riskLevel === 'MEDIUM'
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                        }
                      >
                        {p.riskLevel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono">
                      <span
                        className={
                          p.congestionClass === 'SEVERE'
                            ? 'text-red-400'
                            : p.congestionClass === 'HIGH'
                            ? 'text-orange-400'
                            : p.congestionClass === 'MODERATE'
                            ? 'text-yellow-400'
                            : 'text-emerald-400'
                        }
                      >
                        {p.congestionClass}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-white">
                      {p.riskScore}/100
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
