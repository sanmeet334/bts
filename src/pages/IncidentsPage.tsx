import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Upload, Search, LocateFixed } from 'lucide-react';
import { WorkspaceLayout } from '../components/Layout';
import { TrafficMap } from '../components/TrafficMap';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  ClientSuggestionItem,
  useGoogleMapsServices,
} from '../hooks/useGoogleMapsServices';
import { incidentsApi, routesApi } from '../services/api';
import {
  IncidentDTO,
  IncidentSeverity,
  IncidentType,
  RoadNodeDTO,
  RoadSegmentDTO,
} from '../shared/types';

const INCIDENT_TYPES: IncidentType[] = [
  'ACCIDENT',
  'ROADBLOCK',
  'CONGESTION',
  'CONSTRUCTION',
  'LANE_CLOSURE',
  'BREAKDOWN',
  'FLOODING',
  'OTHER',
];

const SEVERITIES: IncidentSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function IncidentsPage() {
  const { user, socket } = useAuth();
  const { pushToast } = useToast();

  const [nodes, setNodes] = useState<RoadNodeDTO[]>([]);
  const [segments, setSegments] = useState<RoadSegmentDTO[]>([]);
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Form state
  const [type, setType] = useState<IncidentType>('ACCIDENT');
  const [severity, setSeverity] = useState<IncidentSeverity>('HIGH');
  const [roadSegmentId, setRoadSegmentId] = useState('');
  const [latitude, setLatitude] = useState(15.8548);
  const [longitude, setLongitude] = useState(74.5025);
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSubmitted, setLastSubmitted] = useState<IncidentDTO | null>(null);
  const [locQuery, setLocQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState<ClientSuggestionItem[]>([]);
  const [searchingLoc, setSearchingLoc] = useState(false);

  const { isSdkReady, fetchPlaceSuggestions, resolvePlaceSuggestion } =
    useGoogleMapsServices();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [net, list] = await Promise.all([
        routesApi.getNetwork(),
        incidentsApi.list({
          status: statusFilter,
          type: typeFilter,
          search: searchTerm || undefined,
        }),
      ]);
      setNodes(net.nodes);
      setSegments(net.segments);
      setIncidents(list);
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Load Failed', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, searchTerm, pushToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => fetchData();
    socket.on('incident:created', refresh);
    socket.on('incident:verified', refresh);
    socket.on('incident:resolved', refresh);
    socket.on('incident:updated', refresh);
    socket.on('road:status-changed', refresh);
    return () => {
      socket.off('incident:created', refresh);
      socket.off('incident:verified', refresh);
      socket.off('incident:resolved', refresh);
      socket.off('incident:updated', refresh);
      socket.off('road:status-changed', refresh);
    };
  }, [socket, fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setFormError('Please sign in to submit an incident report.');
      return;
    }
    setFormError(null);
    setSubmitting(true);

    try {
      const fd = new FormData();
      fd.append('type', type);
      fd.append('severity', severity);
      fd.append('description', description);
      fd.append('latitude', String(latitude));
      fd.append('longitude', String(longitude));
      if (roadSegmentId) fd.append('roadSegmentId', roadSegmentId);
      if (imageFile) fd.append('image', imageFile);

      const res = await incidentsApi.submit(fd);
      setLastSubmitted(res.incident);
      setDescription('');
      setImageFile(null);
      await fetchData();

      pushToast({
        variant: res.possibleDuplicate ? 'warning' : 'success',
        title: res.possibleDuplicate
          ? 'Report Submitted (Flagged Possible Duplicate)'
          : 'Incident Submitted for Review',
        message: `ID ${res.incidentId} · Status: ${res.status}`,
      });
    } catch (err: any) {
      setFormError(err.message || 'Server rejected incident report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WorkspaceLayout title="Incident Reporting & Intelligent Detection" breadcrumb="Incidents">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Report Submission Form */}
        <div className="xl:col-span-5 space-y-5">
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Submit Traffic Incident</h2>
              <span className="text-xs text-slate-400">Click map to set pin</span>
            </div>

            {!user && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-3 text-xs text-amber-200 flex items-center justify-between gap-3">
                <span>Sign in required to submit verified reports.</span>
                <Link to="/login" className="text-blue-400 hover:underline font-medium shrink-0">
                  Sign In
                </Link>
              </div>
            )}

            {formError && (
              <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as IncidentType)}
                  className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                >
                  {INCIDENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Reported Severity
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                  className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Road Segment (Auto-snapped if omitted)
              </label>
              <select
                value={roadSegmentId}
                onChange={(e) => setRoadSegmentId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
              >
                <option value="">Auto-detect nearest corridor from pin</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-300">
                  Find Location or Click Map
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (!navigator.geolocation) {
                      pushToast({
                        variant: 'error',
                        title: 'Geolocation Unsupported',
                        message: 'Browser does not support GPS location.',
                      });
                      return;
                    }
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        setLatitude(Number(pos.coords.latitude.toFixed(5)));
                        setLongitude(Number(pos.coords.longitude.toFixed(5)));
                        pushToast({ variant: 'success', title: 'Incident Pin Set to Current Location' });
                      },
                      (err) => {
                        pushToast({ variant: 'error', title: 'Location Permission Denied', message: err.message });
                      }
                    );
                  }}
                  className="inline-flex items-center gap-1 rounded bg-emerald-600/20 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-600/35"
                >
                  <LocateFixed className="w-3 h-3" />
                  <span>Use My Location</span>
                </button>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={locQuery}
                  onChange={(e) => setLocQuery(e.target.value)}
                  placeholder="Search street or landmark for pin..."
                  className="flex-1 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-1.5 text-xs text-white"
                />
                <button
                  type="button"
                  disabled={searchingLoc}
                  onClick={async () => {
                    const q = locQuery.trim();
                    if (q.length < 2) return;
                    setSearchingLoc(true);
                    try {
                      if (isSdkReady) {
                        const gRes = await fetchPlaceSuggestions(q, 'origin');
                        if (gRes && gRes.length > 0) {
                          setLocSuggestions(gRes);
                          return;
                        }
                      }
                      const res = await routesApi.geocode(q);
                      setLocSuggestions(res.results);
                    } catch {
                      setLocSuggestions([]);
                    } finally {
                      setSearchingLoc(false);
                    }
                  }}
                  className="rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                >
                  {searchingLoc ? '...' : 'Search'}
                </button>
              </div>
              {locSuggestions.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-700 bg-[#090E1A]">
                  {locSuggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={async () => {
                        let lat = s.latitude;
                        let lng = s.longitude;
                        let label = s.name;
                        if (s.placePrediction) {
                          const fetched = await resolvePlaceSuggestion(s, 'origin');
                          if (!fetched) return;
                          lat = fetched.latitude;
                          lng = fetched.longitude;
                          label = fetched.name;
                        }
                        setLatitude(Number(lat.toFixed(5)));
                        setLongitude(Number(lng.toFixed(5)));
                        setLocQuery(label);
                        setLocSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 border-b border-slate-800 last:border-0 truncate"
                    >
                      {s.displayName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Latitude
                </label>
                <input
                  type="number"
                  step="0.00001"
                  required
                  value={latitude}
                  onChange={(e) => setLatitude(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Longitude
                </label>
                <input
                  type="number"
                  step="0.00001"
                  required
                  value={longitude}
                  onChange={(e) => setLongitude(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm font-mono text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Incident Description
              </label>
              <textarea
                rows={3}
                required
                minLength={8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe lane blockage, collision severity, or obstruction..."
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Optional Evidence Photograph (JPEG/PNG/WebP, max 3MB)
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-dashed border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-xs text-slate-300 cursor-pointer hover:border-blue-500/50">
                <Upload className="w-4 h-4 text-slate-400" />
                <span className="truncate">
                  {imageFile ? imageFile.name : 'Choose optional image file...'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || !user}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Validating & Analyzing...' : 'Submit Incident Report'}
            </button>
          </form>

          {/* Server Duplicate & Severity Estimation Readout */}
          {lastSubmitted && (
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Server Analysis Result</span>
                <span className="font-mono text-cyan-400">{lastSubmitted.id}</span>
              </div>
              <div className="text-slate-300 space-y-1">
                <p>
                  Workflow Status: <span className="font-mono text-amber-300">{lastSubmitted.status}</span>
                </p>
                <p>
                  Estimated Severity:{' '}
                  <span className="font-mono text-white">{lastSubmitted.estimatedSeverity}</span> (Confidence{' '}
                  {Math.round(lastSubmitted.severityConfidence * 100)}%)
                </p>
                <p>
                  Duplicate Check:{' '}
                  {lastSubmitted.possibleDuplicate ? (
                    <span className="text-amber-300">{lastSubmitted.duplicateReason}</span>
                  ) : (
                    <span className="text-emerald-400">No nearby duplicate detected</span>
                  )}
                </p>
              </div>
              <ul className="list-disc list-inside text-slate-400 space-y-0.5 pt-1">
                {lastSubmitted.severityReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right Map & Live Incident Feed */}
        <div className="xl:col-span-7 space-y-5">
          <TrafficMap
            nodes={nodes}
            segments={segments}
            incidents={incidents}
            selectedPin={{ lat: latitude, lng: longitude }}
            selectedSegmentId={roadSegmentId || undefined}
            onMapClick={(lat, lng) => {
              setLatitude(lat);
              setLongitude(lng);
            }}
            onSegmentSelect={(seg, latLng) => {
              setRoadSegmentId(seg.id);
              if (latLng) {
                setLatitude(Number(latLng.lat.toFixed(5)));
                setLongitude(Number(latLng.lng.toFixed(5)));
              }
            }}
            heightClass="h-[360px]"
          />

          {/* Filters */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search incident description or road..."
                  className="w-full rounded-lg border border-slate-700 bg-[#090E1A] pl-8 pr-3 py-2 text-xs text-white"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Visible Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="VERIFIED">Verified</option>
                <option value="RESOLVED">Resolved</option>
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-white"
              >
                <option value="ALL">All Types</option>
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-slate-400">
                Loading incident reports...
              </div>
            ) : incidents.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">
                No incidents match the selected filters.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {incidents.map((inc) => (
                  <div key={inc.id} className="py-3.5 flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-white">{inc.type}</span>
                        <span className="text-slate-500">·</span>
                        <span
                          className={`font-mono ${
                            inc.severity === 'CRITICAL' || inc.severity === 'HIGH'
                              ? 'text-red-400'
                              : inc.severity === 'MEDIUM'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {inc.severity}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="font-mono text-cyan-300">{inc.status}</span>
                        {inc.possibleDuplicate && (
                          <>
                            <span className="text-slate-500">·</span>
                            <span className="text-amber-300">Possible Duplicate</span>
                          </>
                        )}
                      </div>
                      <p className="text-sm text-slate-200">{inc.description}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {inc.roadSegmentName || `${inc.latitude}, ${inc.longitude}`}
                        </span>
                        <span>·</span>
                        <span className="font-mono">
                          {new Date(inc.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <Link
                      to={`/incidents/${inc.id}`}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 shrink-0 whitespace-nowrap"
                    >
                      Inspect
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
