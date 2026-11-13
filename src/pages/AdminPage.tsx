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
} from 'recharts';
import { Download, Play, Square, Check, X as XIcon, CheckCheck } from 'lucide-react';
import { Dashboard } from '../components/Dashboard';
import { WorkspaceLayout } from '../components/Layout';
import { TrafficMap } from '../components/TrafficMap';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  analyticsApi,
  incidentsApi,
  routesApi,
  simulationsApi,
} from '../services/api';
import {
  AnalyticsOverviewDTO,
  AuditLogDTO,
  IncidentDTO,
  NetworkImpactResultDTO,
  RoadNodeDTO,
  RoadSegmentDTO,
  SimulationScenarioDTO,
} from '../shared/types';

export function AdminPage() {
  const { user, socket } = useAuth();
  const { pushToast } = useToast();

  const [tab, setTab] = useState<'review' | 'simulations' | 'analytics' | 'audit'>('review');
  const [nodes, setNodes] = useState<RoadNodeDTO[]>([]);
  const [segments, setSegments] = useState<RoadSegmentDTO[]>([]);
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);

  const [selectedIncident, setSelectedIncident] = useState<IncidentDTO | null>(null);
  const [impactResult, setImpactResult] = useState<NetworkImpactResultDTO | null>(null);

  const [simulations, setSimulations] = useState<SimulationScenarioDTO[]>([]);
  const [simName, setSimName] = useState('KLE Corridor Peak Closure Test');
  const [simType, setSimType] = useState<'FULL_CLOSURE' | 'LANE_BLOCKAGE'>('FULL_CLOSURE');
  const [simSegmentId, setSimSegmentId] = useState('seg-12');

  const [overview, setOverview] = useState<AnalyticsOverviewDTO | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  const isAdmin = user?.role === 'ADMIN';
  const isOperator = user && ['ADMIN', 'SIGNAL_OPERATOR'].includes(user.role);

  const loadAll = useCallback(async () => {
    if (!isOperator) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [net, incs, sims, ov] = await Promise.all([
        routesApi.getNetwork(),
        incidentsApi.list({
          status: statusFilter,
          onlyDuplicates,
        }),
        simulationsApi.list(),
        analyticsApi.getOverview(),
      ]);
      setNodes(net.nodes);
      setSegments(net.segments);
      setIncidents(incs);
      setSimulations(sims);
      setOverview(ov);
      if (isAdmin) {
        const logs = await analyticsApi.getAuditLogs(60);
        setAuditLogs(logs);
      }
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Admin Load Failed', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [isOperator, isAdmin, statusFilter, onlyDuplicates, pushToast]);

  useEffect(() => {
    loadAll();
  }, [user, statusFilter, onlyDuplicates]);

  useEffect(() => {
    if (!socket || !isOperator) return;
    const refresh = () => loadAll();
    socket.on('incident:created', refresh);
    socket.on('incident:updated', refresh);
    socket.on('road:status-changed', refresh);
    return () => {
      socket.off('incident:created', refresh);
      socket.off('incident:updated', refresh);
      socket.off('road:status-changed', refresh);
    };
  }, [socket, isOperator, loadAll]);

  const handleReviewAction = async (
    incidentId: string,
    status: 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'RESOLVED',
    applyRoadClosure = false
  ) => {
    setActionBusy(true);
    try {
      const updated = await incidentsApi.updateStatus(incidentId, {
        status,
        applyRoadClosure,
      });
      setSelectedIncident(updated);
      await loadAll();
      pushToast({
        variant: 'success',
        title: `Incident ${status}`,
        message: `Updated ${incidentId} and broadcasted network state.`,
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Review Action Failed', message: err.message });
    } finally {
      setActionBusy(false);
    }
  };

  const handleAnalyzeImpact = async (incidentId: string) => {
    try {
      const res = await incidentsApi.runImpactAnalysis(incidentId);
      setImpactResult(res);
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Impact Analysis Failed', message: err.message });
    }
  };

  const handleStartSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const scenario = await simulationsApi.createClosure({
        name: simName,
        type: simType,
        targetSegmentId: simSegmentId,
      });
      await loadAll();
      pushToast({
        variant: 'success',
        title: 'Simulation Started',
        message: `${scenario.name} (+${scenario.results.addedDelayMin}m detour impact, real road preserved)`,
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Simulation Failed', message: err.message });
    }
  };

  const handleEndSimulation = async (id: string) => {
    try {
      await simulationsApi.end(id);
      await loadAll();
      pushToast({
        variant: 'info',
        title: 'Simulation Ended',
        message: 'Baseline road network state restored.',
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'End Simulation Failed', message: err.message });
    }
  };

  const handleExportCsv = async () => {
    try {
      const blob = await analyticsApi.downloadCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'traffix-operational-summary.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'CSV Export Failed', message: err.message });
    }
  };

  if (!user || !isOperator) {
    return (
      <WorkspaceLayout title="Traffic Operations & Network Impact Admin" breadcrumb="Admin">
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 max-w-lg space-y-3">
          <p className="text-sm text-slate-300">
            Traffic Administrator or Signal Operator authorization required. Access is strictly
            enforced on the backend.
          </p>
          <Link
            to="/login"
            className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Sign In as Traffic Admin
          </Link>
        </div>
      </WorkspaceLayout>
    );
  }

  return (
    <WorkspaceLayout
      title="Administration, Network Impact & Simulation Lab"
      breadcrumb="Admin"
      actions={
        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1424] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
      }
    >
      <div className="space-y-6">
        {/* Segmented Workspace Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0D1424] border border-slate-800 rounded-lg w-fit">
          {(
            [
              { id: 'review', label: 'Incident Review Queue' },
              { id: 'simulations', label: 'Closure & Blockage Lab' },
              { id: 'analytics', label: 'Traffic Overview' },
              ...(isAdmin ? [{ id: 'audit' as const, label: 'Audit Logs' }] : []),
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* TAB 1: Incident Review Queue & Network Impact */}
        {tab === 'review' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7 rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-white">Incident Queue</h2>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={onlyDuplicates}
                      onChange={(e) => setOnlyDuplicates(e.target.checked)}
                      className="accent-blue-500"
                    />
                    <span>Duplicates Only</span>
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-1.5 text-xs text-white"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PENDING">Pending</option>
                    <option value="UNDER_REVIEW">Under Review</option>
                    <option value="VERIFIED">Verified</option>
                    <option value="REJECTED">Rejected</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <p className="text-xs text-slate-400 py-6 text-center">Loading queue...</p>
              ) : incidents.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                  No incidents match current filter.
                </p>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {incidents.map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => {
                        setSelectedIncident(inc);
                        setImpactResult(null);
                      }}
                      className={`py-3.5 px-3 rounded-lg cursor-pointer transition-colors ${
                        selectedIncident?.id === inc.id
                          ? 'bg-blue-950/30'
                          : 'hover:bg-slate-800/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-white">
                          {inc.type} · {inc.roadSegmentName || 'Unmapped'}
                        </span>
                        <span className="font-mono text-cyan-300">{inc.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300 line-clamp-2">{inc.description}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] font-mono text-slate-400">
                        <span>Severity: {inc.severity}</span>
                        <span>Est: {inc.estimatedSeverity}</span>
                        {inc.possibleDuplicate && (
                          <span className="text-amber-300">
                            Possible Duplicate ({inc.duplicateScore})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-5 space-y-5">
              {selectedIncident ? (
                <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4">
                  <div className="border-b border-slate-800 pb-3">
                    <p className="text-xs font-mono text-cyan-400">
                      {selectedIncident.id} · {selectedIncident.status}
                    </p>
                    <h3 className="text-base font-semibold text-white mt-0.5">
                      {selectedIncident.type} — {selectedIncident.roadSegmentName || 'Corridor'}
                    </h3>
                  </div>

                  <p className="text-xs text-slate-200 leading-relaxed">
                    {selectedIncident.description}
                  </p>

                  {selectedIncident.possibleDuplicate && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200">
                      Duplicate Alert: {selectedIncident.duplicateReason}
                    </div>
                  )}

                  <div className="text-xs space-y-1 text-slate-300">
                    <p>
                      Reporter: {selectedIncident.reporterName || selectedIncident.reporterId}
                    </p>
                    <p>
                      Estimated Severity: {selectedIncident.estimatedSeverity} (
                      {Math.round(selectedIncident.severityConfidence * 100)}%)
                    </p>
                  </div>

                  {isAdmin && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {selectedIncident.status === 'PENDING' && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() =>
                            handleReviewAction(selectedIncident.id, 'UNDER_REVIEW', false)
                          }
                          className="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-950/30 disabled:opacity-50"
                        >
                          Under Review
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() =>
                          handleReviewAction(selectedIncident.id, 'VERIFIED', false)
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Verify Incident</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() =>
                          handleReviewAction(selectedIncident.id, 'VERIFIED', true)
                        }
                        className="rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                      >
                        Verify & Close Road
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleReviewAction(selectedIncident.id, 'RESOLVED')}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>Resolve</span>
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleReviewAction(selectedIncident.id, 'REJECTED')}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 px-3 py-2 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}

                  <div className="border-t border-slate-800 pt-3">
                    <button
                      type="button"
                      onClick={() => handleAnalyzeImpact(selectedIncident.id)}
                      className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2 text-xs font-medium text-cyan-300 hover:bg-slate-800"
                    >
                      Run Connected-Road Network Impact Analysis
                    </button>
                  </div>

                  {impactResult && (
                    <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3.5 space-y-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-white">Downstream Impact (SIMULATED)</p>
                        <span
                          className={`font-mono text-[11px] ${
                            impactResult.networkConnectivityIntact
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          {impactResult.networkConnectivityIntact
                            ? `Connectivity Intact · +${impactResult.estimatedAddedTravelTimeMin}m delay`
                            : 'Critical Cut-Edge (Disconnected)'}
                        </span>
                      </div>
                      <p className="text-slate-300">{impactResult.summary}</p>
                      <div className="space-y-1">
                        {impactResult.downstreamSegments.map((ds) => (
                          <div key={ds.segmentId} className="flex justify-between text-slate-400">
                            <span>
                              {ds.segmentName} (Hop {ds.hopDistance})
                            </span>
                            <span className="font-mono tabular-nums text-amber-300">
                              +{ds.estimatedLoadIncreasePct}%
                            </span>
                          </div>
                        ))}
                      </div>
                      {impactResult.alternativeDetours.length > 0 && (
                        <div className="border-t border-slate-800 pt-2.5 space-y-1.5">
                          <p className="font-semibold text-cyan-300">Recommended Diversions</p>
                          {impactResult.alternativeDetours.map((detour, idx) => (
                            <div key={idx} className="space-y-1 text-slate-300">
                              <p className="text-white font-medium">
                                {detour.fromNodeName} → {detour.toNodeName}
                              </p>
                              <p className="text-slate-300">
                                {detour.segmentNames.join(' → ')}
                              </p>
                              <p className="font-mono text-[11px] text-cyan-400 tabular-nums">
                                Detour {detour.detourDistanceKm} km · +{detour.addedTimeMin} min added delay
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-8 text-center text-xs text-slate-400">
                  Select an incident from the review queue to inspect evidence, duplicate matches,
                  verification controls, and downstream network impact.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Road Closure & Lane-Blockage Simulation Lab */}
        {tab === 'simulations' && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-5 space-y-5">
              <form
                onSubmit={handleStartSimulation}
                className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4"
              >
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Non-Destructive Closure Simulation
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Simulates full closure or lane restriction in route calculation without
                    overwriting real road records.
                  </p>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Scenario Name</label>
                  <input
                    type="text"
                    required
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Target Road Segment</label>
                  <select
                    value={simSegmentId}
                    onChange={(e) => setSimSegmentId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                  >
                    {segments.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.effectiveClosureStatus})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Blockage Mode</label>
                  <select
                    value={simType}
                    onChange={(e) => setSimType(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                  >
                    <option value="FULL_CLOSURE">Full Road Closure (Excluded from Routing)</option>
                    <option value="LANE_BLOCKAGE">One-Lane Blockage (+22% load penalty)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  <Play className="w-4 h-4" />
                  <span>Start Simulation Scenario</span>
                </button>
              </form>

              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4 space-y-3">
                <h3 className="text-sm font-semibold text-white">Scenario History</h3>
                {simulations.length === 0 ? (
                  <p className="text-xs text-slate-400">No simulation scenarios recorded.</p>
                ) : (
                  <div className="space-y-2.5">
                    {simulations.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-lg border border-slate-800 bg-[#090E1A] p-3 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-white">{s.name}</span>
                          <span
                            className={`font-mono ${
                              s.status === 'ACTIVE' ? 'text-amber-300' : 'text-slate-500'
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>
                        <p className="text-slate-400">
                          {s.targetSegmentName} · {s.type} · +{s.results.addedDelayMin}m delay
                        </p>
                        {s.results.detourPathNames.length > 0 && (
                          <p className="text-[11px] text-cyan-300">
                            Detour: {s.results.detourPathNames.join(' → ')}
                          </p>
                        )}
                        {s.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => handleEndSimulation(s.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-500/40 px-2.5 py-1 text-[11px] text-red-300 hover:bg-red-950/30"
                          >
                            <Square className="w-3 h-3" />
                            <span>End Scenario & Restore Road</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="xl:col-span-7">
              <TrafficMap
                nodes={nodes}
                segments={segments}
                incidents={incidents}
                selectedSegmentId={simSegmentId}
                onSegmentSelect={(seg) => setSimSegmentId(seg.id)}
                heightClass="h-[520px]"
              />
            </div>
          </div>
        )}

        {/* TAB 3: Traffic Overview Analytics */}
        {tab === 'analytics' && overview && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
                <p className="text-xs text-slate-400">Open / Restricted / Closed</p>
                <p className="mt-1.5 text-xl font-mono text-white tabular-nums">
                  {overview.networkSummary.openSegments} /{' '}
                  {overview.networkSummary.restrictedSegments} /{' '}
                  {overview.networkSummary.closedSegments}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
                <p className="text-xs text-slate-400">Incidents (Pending / Verified)</p>
                <p className="mt-1.5 text-xl font-mono text-white tabular-nums">
                  {overview.incidentStats.pending} / {overview.incidentStats.verified}
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
                <p className="text-xs text-slate-400">Signal Wait Reduction</p>
                <p className="mt-1.5 text-xl font-mono text-emerald-400 tabular-nums">
                  {overview.signalStats.avgWaitReductionPct}% avg
                </p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4">
                <p className="text-xs text-slate-400">Emergency Time Saved</p>
                <p className="mt-1.5 text-xl font-mono text-cyan-300 tabular-nums">
                  {overview.emergencyStats.avgTimeSavedMin} min avg
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5">
              <h3 className="text-sm font-semibold text-white mb-4">
                Top Affected Corridors — Congestion Load (%)
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={overview.topAffectedRoads.map((r) => ({
                      name: r.name.split(' ').slice(0, 2).join(' '),
                      LoadPct: Math.round(r.currentCongestion * 100),
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#111827',
                        borderColor: '#334155',
                        color: '#F8FAFC',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="LoadPct" fill="#F97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <Dashboard overview={overview} compact />
          </div>
        )}

        {/* TAB 4: Audit Log */}
        {tab === 'audit' && isAdmin && (
          <div className="rounded-xl border border-slate-800 bg-[#0D1424] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Immutable Operational Audit Log</h3>
              <span className="text-xs font-mono text-slate-400">{auditLogs.length} entries</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090E1A] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Timestamp</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Target</th>
                    <th className="px-4 py-3 font-medium">Before → After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-2.5 font-mono text-slate-400 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-slate-200">{log.actorEmail}</td>
                      <td className="px-4 py-2.5 font-mono text-cyan-300">{log.action}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-300">
                        {log.targetType}:{log.targetId}
                      </td>
                      <td className="px-4 py-2.5 text-slate-300">
                        {log.beforeSummary} → {log.afterSummary}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </WorkspaceLayout>
  );
}
