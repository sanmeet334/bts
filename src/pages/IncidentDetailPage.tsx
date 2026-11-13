import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { WorkspaceLayout } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { incidentsApi } from '../services/api';
import { IncidentDTO, NetworkImpactResultDTO } from '../shared/types';

export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [incident, setIncident] = useState<IncidentDTO | null>(null);
  const [matches, setMatches] = useState<Array<any>>([]);
  const [impact, setImpact] = useState<NetworkImpactResultDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    incidentsApi
      .getById(id)
      .then((data) => {
        setIncident(data.incident);
        setMatches(data.matches);
      })
      .catch((err: any) => setError(err.message || 'Incident not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleRunImpact = async () => {
    if (!id) return;
    try {
      const res = await incidentsApi.runImpactAnalysis(id);
      setImpact(res);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <WorkspaceLayout
      title={incident ? `Incident ${incident.id}` : 'Incident Details'}
      breadcrumb="Incidents / Detail"
      actions={
        <Link
          to="/incidents"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Incidents</span>
        </Link>
      }
    >
      {loading ? (
        <div className="text-sm text-slate-400">Loading incident details...</div>
      ) : error || !incident ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-5 text-sm text-red-200">
          {error || 'Incident not found'}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-5">
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
                <div>
                  <p className="text-xs font-mono text-cyan-400">
                    {incident.type} · {incident.status}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {incident.roadSegmentName || 'Unmapped Corridor'}
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {new Date(incident.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="text-sm text-slate-200 leading-relaxed">{incident.description}</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 text-xs">
                <div>
                  <p className="text-slate-400">Reported Severity</p>
                  <p className="mt-1 font-mono text-white">{incident.severity}</p>
                </div>
                <div>
                  <p className="text-slate-400">Estimated Severity</p>
                  <p className="mt-1 font-mono text-amber-300">
                    {incident.estimatedSeverity} ({Math.round(incident.severityConfidence * 100)}%)
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Coordinates</p>
                  <p className="mt-1 font-mono text-slate-200">
                    {incident.latitude}, {incident.longitude}
                  </p>
                </div>
              </div>

              {incident.imageUrl && (
                <div className="pt-2">
                  <p className="text-xs text-slate-400 mb-2">Uploaded Evidence</p>
                  <img
                    src={incident.imageUrl}
                    alt="Incident evidence"
                    referrerPolicy="no-referrer"
                    className="max-h-64 rounded-lg border border-slate-800 object-cover"
                  />
                </div>
              )}
            </div>

            {user && ['ADMIN', 'SIGNAL_OPERATOR', 'EMERGENCY_OPERATOR'].includes(user.role) && (
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    Connected-Road Impact Analysis
                  </h3>
                  <button
                    type="button"
                    onClick={handleRunImpact}
                    className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                  >
                    Run Network Impact
                  </button>
                </div>
                {impact && (
                  <div className="space-y-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-slate-300">{impact.summary}</p>
                      <span
                        className={`font-mono text-[11px] ${
                          impact.networkConnectivityIntact ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {impact.networkConnectivityIntact
                          ? `Bypass Available (+${impact.estimatedAddedTravelTimeMin}m)`
                          : 'Critical Cut-Edge'}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {impact.downstreamSegments.map((d) => (
                        <div
                          key={d.segmentId}
                          className="flex justify-between rounded border border-slate-800 bg-[#090E1A] px-3 py-2"
                        >
                          <span className="text-slate-200">
                            {d.segmentName} (Hop {d.hopDistance})
                          </span>
                          <span className="font-mono tabular-nums text-amber-300">
                            +{d.estimatedLoadIncreasePct}% load ·{' '}
                            {Math.round(d.projectedCongestion * 100)}% total
                          </span>
                        </div>
                      ))}
                    </div>
                    {impact.alternativeDetours.length > 0 && (
                      <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3 space-y-1.5">
                        <p className="font-semibold text-cyan-300">Recommended Diversions (Simulated)</p>
                        {impact.alternativeDetours.map((detour, idx) => (
                          <div key={idx} className="space-y-1">
                            <p className="text-white font-medium">
                              {detour.fromNodeName} → {detour.toNodeName}
                            </p>
                            <p className="text-slate-300">{detour.segmentNames.join(' → ')}</p>
                            <p className="font-mono text-[11px] text-cyan-400 tabular-nums">
                              {detour.detourDistanceKm} km · +{detour.addedTimeMin} min added time
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 space-y-5">
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">Severity Estimation Factors</h3>
              <ul className="list-disc list-inside text-xs text-slate-300 space-y-1.5">
                {incident.severityReasons.map((r, idx) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">Duplicate Detection Audit</h3>
              {incident.possibleDuplicate ? (
                <p className="text-xs text-amber-300">{incident.duplicateReason}</p>
              ) : (
                <p className="text-xs text-slate-400">
                  No nearby duplicate matches recorded for this incident.
                </p>
              )}
              {matches.length > 0 && (
                <div className="space-y-2 pt-2">
                  {matches.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-lg border border-slate-800 bg-[#090E1A] p-3 text-xs space-y-1"
                    >
                      <p className="font-mono text-cyan-300">
                        Match Score: {m.similarity_score} · {Math.round(m.distance_meters)}m
                      </p>
                      <p className="text-slate-300">{m.reason}</p>
                      <p className="text-slate-400">Outcome: {m.review_outcome}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </WorkspaceLayout>
  );
}
