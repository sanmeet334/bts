import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ambulance, RefreshCw } from 'lucide-react';
import { WorkspaceLayout } from '../components/Layout';
import { TrafficMap } from '../components/TrafficMap';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { emergencyApi, incidentsApi, routesApi } from '../services/api';
import {
  EmergencyPriorityLevel,
  EmergencyTripDTO,
  EmergencyVehicleDTO,
  IncidentDTO,
  RoadNodeDTO,
  RoadSegmentDTO,
} from '../shared/types';

export function EmergencyPage() {
  const { user, socket } = useAuth();
  const { pushToast } = useToast();

  const [nodes, setNodes] = useState<RoadNodeDTO[]>([]);
  const [segments, setSegments] = useState<RoadSegmentDTO[]>([]);
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [vehicles, setVehicles] = useState<EmergencyVehicleDTO[]>([]);
  const [trips, setTrips] = useState<EmergencyTripDTO[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<EmergencyTripDTO | null>(null);

  const [vehicleId, setVehicleId] = useState('');
  const [originNodeId, setOriginNodeId] = useState('node-camp');
  const [destinationNodeId, setDestinationNodeId] = useState('node-kle');
  const [priorityLevel, setPriorityLevel] = useState<EmergencyPriorityLevel>('CRITICAL_CODE_3');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [updatingTrip, setUpdatingTrip] = useState(false);

  const isAuthorized =
    user && ['EMERGENCY_OPERATOR', 'ADMIN', 'SIGNAL_OPERATOR'].includes(user.role);
  const canDispatch = user && ['EMERGENCY_OPERATOR', 'ADMIN'].includes(user.role);

  const loadAll = useCallback(async () => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [net, incs, vehs, trps] = await Promise.all([
        routesApi.getNetwork(),
        incidentsApi.list({ status: 'VERIFIED' }),
        emergencyApi.listVehicles(),
        emergencyApi.listTrips(),
      ]);
      setNodes(net.nodes);
      setSegments(net.segments);
      setIncidents(incs);
      setVehicles(vehs);
      setTrips(trps);
      if (!vehicleId && vehs.length > 0) setVehicleId(vehs[0].id);
      if (trps.length > 0 && !selectedTrip) setSelectedTrip(trps[0]);
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Load Failed', message: err.message });
    } finally {
      setLoading(false);
    }
  }, [isAuthorized, vehicleId, selectedTrip, pushToast]);

  useEffect(() => {
    loadAll();
  }, [user]);

  useEffect(() => {
    if (!socket || !isAuthorized) return;
    const onTrip = (msg: any) => {
      emergencyApi.listTrips().then((list) => {
        setTrips(list);
        if (msg?.payload?.id && selectedTrip?.id === msg.payload.id) {
          setSelectedTrip(msg.payload);
        }
      });
    };
    const onRoadChanged = () => {
      loadAll();
    };
    socket.on('emergency:trip-updated', onTrip);
    socket.on('road:status-changed', onRoadChanged);
    return () => {
      socket.off('emergency:trip-updated', onTrip);
      socket.off('road:status-changed', onRoadChanged);
    };
  }, [socket, isAuthorized, selectedTrip?.id, loadAll]);

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleId) return;
    setSubmitting(true);
    try {
      const trip = await emergencyApi.createTrip({
        vehicleId,
        originNodeId,
        destinationNodeId,
        priorityLevel,
      });
      setSelectedTrip(trip);
      setTrips(await emergencyApi.listTrips());
      pushToast({
        variant: 'success',
        title: 'Priority Corridor Computed',
        message: `Priority ETA ${trip.priorityEtaMin}m vs Normal ${trip.normalEtaMin}m (${trip.timeSavedMin}m saved)`,
      });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Dispatch Error', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (
    tripId: string,
    status: 'EN_ROUTE' | 'COMPLETED' | 'CANCELLED'
  ) => {
    setUpdatingTrip(true);
    try {
      const updated = await emergencyApi.updateStatus(tripId, status);
      setSelectedTrip(updated);
      setTrips(await emergencyApi.listTrips());
      pushToast({ variant: 'info', title: `Trip Marked ${status}` });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Status Update Failed', message: err.message });
    } finally {
      setUpdatingTrip(false);
    }
  };

  if (!user || !isAuthorized) {
    return (
      <WorkspaceLayout title="Emergency Vehicle Priority Routing" breadcrumb="Emergency">
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 max-w-lg space-y-3">
          <p className="text-sm text-slate-300">
            Authorized Emergency Operator, Signal Operator, or Admin credentials required to
            access emergency priority corridors.
          </p>
          <Link
            to="/login"
            className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Sign In as Emergency Operator / Admin
          </Link>
        </div>
      </WorkspaceLayout>
    );
  }

  const overlays = selectedTrip
    ? [
        ...(selectedTrip.route.normalRoute?.geometry?.length
          ? [
              {
                id: `${selectedTrip.id}-normal`,
                label: `Normal Baseline (${selectedTrip.normalEtaMin} min · ${selectedTrip.route.normalRoute.totalDistanceKm} km)`,
                geometry: selectedTrip.route.normalRoute.geometry,
                color: '#94A3B8',
                dashed: true,
                weight: 4,
                trafficStatus: 'NORMAL BASELINE CORRIDOR (SIMULATED)',
              },
            ]
          : []),
        {
          id: selectedTrip.id,
          label: `Emergency Priority (${selectedTrip.priorityEtaMin} min · ${selectedTrip.route.totalDistanceKm} km)`,
          geometry: selectedTrip.route.geometry,
          color: '#38BDF8',
          weight: 8,
          trafficStatus: 'PRIORITY GREEN-WAVE CORRIDOR (SIMULATED)',
        },
      ]
    : [];

  return (
    <WorkspaceLayout title="Emergency Vehicle Priority Routing" breadcrumb="Emergency">
      <div className="space-y-6">
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-4 py-3 text-xs text-cyan-200">
          PROTOTYPE NOTICE: Priority green-corridor actions and arrival time savings are simulated
          on the city graph. This interface does not dispatch physical emergency fleets or control
          roadside signal hardware.
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Request Form */}
          <div className="xl:col-span-5 space-y-5">
            {canDispatch && (
              <form
                onSubmit={handleCreateTrip}
                className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <Ambulance className="w-4 h-4 text-red-400" />
                  <h2 className="text-base font-semibold text-white">
                    Request Priority Corridor
                  </h2>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">
                    Authorized Vehicle Unit
                  </label>
                  <select
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                  >
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.registrationLabel} ({v.vehicleType})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">Origin</label>
                    <select
                      value={originNodeId}
                      onChange={(e) => setOriginNodeId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-white"
                    >
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">Destination</label>
                    <select
                      value={destinationNodeId}
                      onChange={(e) => setDestinationNodeId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-white"
                    >
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Priority Level</label>
                  <select
                    value={priorityLevel}
                    onChange={(e) => setPriorityLevel(e.target.value as EmergencyPriorityLevel)}
                    className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white"
                  >
                    <option value="CRITICAL_CODE_3">CRITICAL CODE 3 (Max Corridor Preemption)</option>
                    <option value="URGENT">URGENT</option>
                    <option value="STANDARD">STANDARD PRIORITY</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={submitting || vehicles.length === 0}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {submitting ? 'Computing Corridor...' : 'Calculate Emergency Priority Route'}
                </button>
              </form>
            )}

            {/* Trip History */}
            <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-4 space-y-3">
              <h3 className="text-sm font-semibold text-white">Emergency Trip Log</h3>
              {loading ? (
                <p className="text-xs text-slate-400">Loading trips...</p>
              ) : trips.length === 0 ? (
                <p className="text-xs text-slate-400">No emergency trips created yet.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {trips.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTrip(t)}
                      className={`w-full text-left rounded-lg border p-3 text-xs transition-colors ${
                        selectedTrip?.id === t.id
                          ? 'border-blue-500 bg-blue-950/25'
                          : 'border-slate-800 bg-[#090E1A] hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between font-medium text-white">
                        <span>{t.vehicleLabel}</span>
                        <span className="font-mono text-cyan-300">{t.status}</span>
                      </div>
                      <p className="mt-1 text-slate-300">
                        {t.originName} → {t.destinationName}
                      </p>
                      <p className="mt-1 font-mono text-emerald-400">
                        Priority {t.priorityEtaMin}m vs Normal {t.normalEtaMin}m (Saved{' '}
                        {t.timeSavedMin}m)
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Map & Junction Action Plan */}
          <div className="xl:col-span-7 space-y-5">
            {(() => {
              const startNode = selectedTrip
                ? nodes.find((n) => n.id === selectedTrip.originNodeId)
                : null;
              const endNode = selectedTrip
                ? nodes.find((n) => n.id === selectedTrip.destinationNodeId)
                : null;
              return (
                <TrafficMap
                  nodes={nodes}
                  segments={segments}
                  incidents={incidents}
                  routes={overlays}
                  startPoint={
                    startNode
                      ? { lat: startNode.latitude, lng: startNode.longitude, label: startNode.name }
                      : null
                  }
                  endPoint={
                    endNode
                      ? { lat: endNode.latitude, lng: endNode.longitude, label: endNode.name }
                      : null
                  }
                  fitBoundsKey={selectedTrip?.id}
                  highlightNodeIds={
                    selectedTrip ? [selectedTrip.originNodeId, selectedTrip.destinationNodeId] : []
                  }
                  activeRouteSegmentIds={selectedTrip?.route.pathSegmentIds || []}
                  heightClass="h-[380px]"
                />
              );
            })()}

            {selectedTrip && (
              <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div>
                    <p className="text-xs font-mono text-cyan-400">
                      {selectedTrip.priorityLevel} · {selectedTrip.status}
                    </p>
                    <h3 className="text-base font-semibold text-white">
                      {selectedTrip.originName} → {selectedTrip.destinationName}
                    </h3>
                  </div>

                  {canDispatch && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={updatingTrip}
                        onClick={async () => {
                          setUpdatingTrip(true);
                          try {
                            const updated = await emergencyApi.recalculatePriorityRoute(
                              selectedTrip.id
                            );
                            setSelectedTrip(updated);
                            setTrips(await emergencyApi.listTrips());
                            pushToast({ variant: 'info', title: 'Priority Route Refreshed' });
                          } catch (err: any) {
                            pushToast({
                              variant: 'error',
                              title: 'Recalculation Failed',
                              message: err.message,
                            });
                          } finally {
                            setUpdatingTrip(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${updatingTrip ? 'animate-spin' : ''}`} />
                        <span>Recalculate</span>
                      </button>
                      {['ACTIVE', 'EN_ROUTE'].includes(selectedTrip.status) && (
                        <>
                          {selectedTrip.status === 'ACTIVE' && (
                            <button
                              type="button"
                              disabled={updatingTrip}
                              onClick={() => handleStatusChange(selectedTrip.id, 'EN_ROUTE')}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                            >
                              Mark En Route
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={updatingTrip}
                            onClick={() => handleStatusChange(selectedTrip.id, 'COMPLETED')}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            disabled={updatingTrip}
                            onClick={() => handleStatusChange(selectedTrip.id, 'CANCELLED')}
                            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3">
                    <p className="text-slate-400">Normal Baseline ETA</p>
                    <p className="mt-1 text-lg font-mono tabular-nums text-slate-200">
                      {selectedTrip.normalEtaMin} min
                    </p>
                    <p className="mt-0.5 text-[11px] font-mono text-slate-400 tabular-nums">
                      {selectedTrip.route.normalRoute?.totalDistanceKm ?? selectedTrip.route.totalDistanceKm} km (Dashed slate)
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3">
                    <p className="text-slate-400">Priority Corridor ETA</p>
                    <p className="mt-1 text-lg font-mono tabular-nums text-cyan-300">
                      {selectedTrip.priorityEtaMin} min
                    </p>
                    <p className="mt-0.5 text-[11px] font-mono text-cyan-400 tabular-nums">
                      {selectedTrip.route.totalDistanceKm} km (Solid cyan)
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#090E1A] p-3">
                    <p className="text-slate-400">Estimated Time Saved</p>
                    <p className="mt-1 text-lg font-mono tabular-nums text-emerald-400">
                      {selectedTrip.timeSavedMin} min
                    </p>
                    <p className="mt-0.5 text-[11px] font-mono text-emerald-500/90 tabular-nums">
                      {selectedTrip.vehicleType || 'PRIORITY'}
                    </p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-300 mb-2">
                    Simulated Junction Priority Actions ({selectedTrip.junctionActions.length})
                  </h4>
                  {selectedTrip.junctionActions.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Direct corridor without intermediate signalized junctions.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTrip.junctionActions.map((ja) => (
                        <div
                          key={ja.junctionId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090E1A] px-3.5 py-2.5 text-xs"
                        >
                          <div>
                            <span className="font-medium text-white">{ja.junctionName}</span>
                            <p className="text-[11px] text-slate-400">
                              {ja.simulatedControlNotice}
                            </p>
                          </div>
                          <div className="text-right font-mono">
                            <div className="text-cyan-300">{ja.action}</div>
                            <div className="text-slate-400">T+{ja.estimatedArrivalOffsetMin}m</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
