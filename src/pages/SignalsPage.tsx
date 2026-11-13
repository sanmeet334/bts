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
import { CheckCircle2, Play } from 'lucide-react';
import { WorkspaceLayout } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { signalsApi } from '../services/api';
import { JunctionDTO, SignalPlanDTO } from '../shared/types';

export function SignalsPage() {
  const { user, socket } = useAuth();
  const { pushToast } = useToast();

  const [junctions, setJunctions] = useState<JunctionDTO[]>([]);
  const [selectedJunctionId, setSelectedJunctionId] = useState('');
  const [observedDensity, setObservedDensity] = useState(0.65);
  const [observedQueue, setObservedQueue] = useState(18);
  const [activePlan, setActivePlan] = useState<SignalPlanDTO | null>(null);
  const [history, setHistory] = useState<SignalPlanDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const canOperate = user && ['SIGNAL_OPERATOR', 'ADMIN'].includes(user.role);

  const loadSignals = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [jList, hist] = await Promise.all([
        signalsApi.listJunctions(),
        signalsApi.history(),
      ]);
      setJunctions(jList);
      setHistory(hist);
      if (!selectedJunctionId && jList.length > 0) {
        setSelectedJunctionId(jList[0].id);
        setObservedDensity(jList[0].latestDensity);
        setObservedQueue(jList[0].latestQueueLength);
      }
      if (!activePlan && hist.length > 0) {
        setActivePlan(hist[0]);
      }
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Load Failed', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [user, selectedJunctionId, activePlan, pushToast]);

  useEffect(() => {
    loadSignals();
  }, [user]);

  useEffect(() => {
    if (!socket) return;
    const onPlan = () => {
      if (user) {
        signalsApi.history().then(setHistory).catch(() => {});
        signalsApi.listJunctions().then(setJunctions).catch(() => {});
      }
    };
    socket.on('signal:plan-updated', onPlan);
    return () => {
      socket.off('signal:plan-updated', onPlan);
    };
  }, [socket, user]);

  const selectedJunction = junctions.find((j) => j.id === selectedJunctionId);

  const handleJunctionChange = (id: string) => {
    setSelectedJunctionId(id);
    const j = junctions.find((x) => x.id === id);
    if (j) {
      setObservedDensity(j.latestDensity);
      setObservedQueue(j.latestQueueLength);
    }
  };

  const handleOptimize = async () => {
    if (!selectedJunctionId) return;
    setRunning(true);
    try {
      const plan = await signalsApi.optimize({
        junctionId: selectedJunctionId,
        observedDensity,
        observedQueue,
      });
      setActivePlan(plan);
      setHistory(await signalsApi.history());
      pushToast({
        variant: 'success',
        title: 'Adaptive Signal Plan Simulated',
        message: `${plan.junctionName}: wait ${plan.beforeMetrics.avgWaitTimeSec}s → ${plan.afterMetrics.avgWaitTimeSec}s`,
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Optimization Failed', message: err.message });
    } finally {
      setRunning(false);
    }
  };

  const handleApprove = async (planId: string) => {
    try {
      const approved = await signalsApi.approve(planId);
      setActivePlan(approved);
      await loadSignals();
      pushToast({
        variant: 'success',
        title: 'Simulated Plan Approved',
        message: `Approved timing recorded for ${approved.junctionName}`,
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Approval Failed', message: err.message });
    }
  };

  if (!user) {
    return (
      <WorkspaceLayout title="Adaptive Traffic Signal Simulation" breadcrumb="Signals">
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 max-w-lg space-y-3">
          <p className="text-sm text-slate-300">
            Authentication required to inspect junction configurations and run adaptive signal
            simulations.
          </p>
          <Link
            to="/login"
            className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Sign In (Signal Operator / Admin)
          </Link>
        </div>
      </WorkspaceLayout>
    );
  }

  const comparisonData = activePlan
    ? [
        {
          metric: 'Avg Wait (sec)',
          Before: activePlan.beforeMetrics.avgWaitTimeSec,
          After: activePlan.afterMetrics.avgWaitTimeSec,
        },
        {
          metric: 'Max Queue (veh)',
          Before: activePlan.beforeMetrics.maxQueueVehicles,
          After: activePlan.afterMetrics.maxQueueVehicles,
        },
      ]
    : [];

  return (
    <WorkspaceLayout title="Adaptive Traffic Signal Optimization" breadcrumb="Signals">
      <div className="space-y-6">
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-3 text-xs text-cyan-200">
          SIMULATION BOUNDARY: Adaptive phase plans and wait-time comparisons are computed in a
          server-side traffic queue simulator and do not command physical roadside signal controllers.
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Controls */}
          <div className="xl:col-span-5 space-y-5">
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4">
              <h2 className="text-base font-semibold text-white">Junction & Demand Inputs</h2>

              {loading ? (
                <p className="text-xs text-slate-400">Loading configured junctions...</p>
              ) : (
                <>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">
                      Configured Junction
                    </label>
                    <select
                      value={selectedJunctionId}
                      onChange={(e) => handleJunctionChange(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                    >
                      {junctions.map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name} ({j.lanesCount} lanes · cycle {j.cycleLengthSec}s)
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedJunction && (
                    <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3 text-xs text-slate-300 space-y-1">
                      <p>Approaches: {selectedJunction.approaches.join(' · ')}</p>
                      <p className="font-mono text-slate-400">
                        Safety Bounds: Min Green {selectedJunction.minGreenSec}s · Max Green{' '}
                        {selectedJunction.maxGreenSec}s · Cycle {selectedJunction.cycleLengthSec}s
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="flex justify-between text-xs text-slate-300 mb-1">
                      <span>Observed Vehicle Density (Simulated)</span>
                      <span className="font-mono">{Math.round(observedDensity * 100)}%</span>
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="0.98"
                      step="0.02"
                      value={observedDensity}
                      onChange={(e) => setObservedDensity(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>

                  <div>
                    <label className="flex justify-between text-xs text-slate-300 mb-1">
                      <span>Observed Queue Length (Vehicles)</span>
                      <span className="font-mono">{observedQueue} veh</span>
                    </label>
                    <input
                      type="range"
                      min="2"
                      max="60"
                      step="1"
                      value={observedQueue}
                      onChange={(e) => setObservedQueue(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  </div>

                  {canOperate ? (
                    <button
                      type="button"
                      onClick={handleOptimize}
                      disabled={running}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                    >
                      <Play className="w-4 h-4" />
                      <span>
                        {running ? 'Running Simulation...' : 'Optimize & Simulate Signal Plan'}
                      </span>
                    </button>
                  ) : (
                    <p className="text-xs text-amber-300">
                      Read-only view. Sign in as Signal Operator or Admin to run optimizations.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Comparison & Proposed Timings */}
          <div className="xl:col-span-7 space-y-5">
            {activePlan ? (
              <>
                <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                    <div>
                      <p className="text-xs font-mono text-cyan-400">
                        {activePlan.status} · {activePlan.id}
                      </p>
                      <h3 className="text-base font-semibold text-white">
                        {activePlan.junctionName}
                      </h3>
                    </div>
                    {canOperate && activePlan.status === 'SIMULATED' && (
                      <button
                        type="button"
                        onClick={() => handleApprove(activePlan.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve Simulated Plan</span>
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{activePlan.reason}</p>

                  {(() => {
                    const waitDelta = Number(
                      (
                        activePlan.beforeMetrics.avgWaitTimeSec -
                        activePlan.afterMetrics.avgWaitTimeSec
                      ).toFixed(1)
                    );
                    const waitPct =
                      activePlan.beforeMetrics.avgWaitTimeSec > 0
                        ? Math.round((waitDelta / activePlan.beforeMetrics.avgWaitTimeSec) * 100)
                        : 0;
                    const queueDelta =
                      activePlan.beforeMetrics.maxQueueVehicles -
                      activePlan.afterMetrics.maxQueueVehicles;
                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3">
                          <p className="text-slate-400">Avg Wait (Before → After)</p>
                          <p className="mt-1 font-mono text-sm text-white tabular-nums">
                            {activePlan.beforeMetrics.avgWaitTimeSec}s →{' '}
                            <span className="text-emerald-400 font-semibold">
                              {activePlan.afterMetrics.avgWaitTimeSec}s
                            </span>
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-emerald-400 tabular-nums">
                            {waitDelta >= 0 ? `-${waitDelta}s (${waitPct}% lower)` : `+${Math.abs(waitDelta)}s`}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3">
                          <p className="text-slate-400">Max Queue (Before → After)</p>
                          <p className="mt-1 font-mono text-sm text-white tabular-nums">
                            {activePlan.beforeMetrics.maxQueueVehicles} →{' '}
                            <span className="text-cyan-300 font-semibold">
                              {activePlan.afterMetrics.maxQueueVehicles} veh
                            </span>
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-cyan-300 tabular-nums">
                            {queueDelta >= 0 ? `-${queueDelta} veh queue` : `+${Math.abs(queueDelta)} veh`}
                          </p>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3">
                          <p className="text-slate-400">Simulated Throughput</p>
                          <p className="mt-1 font-mono text-sm text-white tabular-nums">
                            {activePlan.beforeMetrics.throughputVph} →{' '}
                            <span className="text-emerald-400 font-semibold">
                              {activePlan.afterMetrics.throughputVph} vph
                            </span>
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                            Queue simulation model
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-400">
                        Phase Timing Comparison (Current → Proposed)
                      </p>
                      {activePlan.proposedTimings.map((pt, idx) => {
                        const cur = activePlan.currentTimings[idx];
                        return (
                          <div
                            key={pt.phaseId}
                            className="rounded-lg border border-slate-800 bg-[#090E1A] p-3 text-xs space-y-1"
                          >
                            <div className="flex justify-between font-medium text-white">
                              <span>
                                {pt.phaseId}: {pt.approach}
                              </span>
                              <span className="font-mono text-cyan-300">
                                {cur?.greenSec ?? 0}s → {pt.greenSec}s Green
                              </span>
                            </div>
                            <p className="font-mono text-[11px] text-slate-400">
                              Amber {pt.amberSec}s · Red {pt.redSec}s
                            </p>
                          </div>
                        );
                      })}
                      <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3 text-xs flex justify-between">
                        <span className="text-slate-400">Modeled Throughput</span>
                        <span className="font-mono text-emerald-400">
                          {activePlan.beforeMetrics.throughputVph} →{' '}
                          {activePlan.afterMetrics.throughputVph} vph
                        </span>
                      </div>
                    </div>

                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparisonData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                          <XAxis dataKey="metric" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                          <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#111827',
                              borderColor: '#334155',
                              color: '#F8FAFC',
                              fontSize: '12px',
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: '11px' }} />
                          <Bar dataKey="Before" fill="#64748B" radius={[3, 3, 0, 0]} />
                          <Bar dataKey="After" fill="#22C55E" radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-8 text-center text-sm text-slate-400">
                Select a junction and run an adaptive optimization simulation to compare wait
                times, queue length, and throughput.
              </div>
            )}

            {/* History Table */}
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Signal Optimization History</h3>
                <span className="text-xs font-mono text-slate-400">{history.length} plans</span>
              </div>
              {history.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No signal simulation runs recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {history.slice(0, 8).map((h) => (
                    <div
                      key={h.id}
                      className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <button
                          type="button"
                          onClick={() => setActivePlan(h)}
                          className="font-medium text-blue-300 hover:underline"
                        >
                          {h.junctionName}
                        </button>
                        <p className="text-slate-400">
                          By {h.initiatedByName || h.initiatedBy} · Wait{' '}
                          <span className="font-mono">
                            {h.beforeMetrics.avgWaitTimeSec}s → {h.afterMetrics.avgWaitTimeSec}s
                          </span>
                        </p>
                      </div>
                      <span
                        className={`font-mono ${
                          h.status === 'APPROVED_SIMULATION' ? 'text-emerald-400' : 'text-cyan-300'
                        }`}
                      >
                        {h.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
