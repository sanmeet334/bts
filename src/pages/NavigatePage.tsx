import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpDown,
  Bookmark,
  Crosshair,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
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
  GeocodeSuggestionDTO,
  IncidentDTO,
  LocationPointDTO,
  RoadNodeDTO,
  RoadSegmentDTO,
  RouteAlternativeDTO,
  RouteAlternativesResultDTO,
} from '../shared/types';

function formatTrafficBadge(level?: string) {
  switch (level) {
    case 'SEVERE':
      return 'bg-red-500/20 text-red-300 border-red-500/40';
    case 'HIGH':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
    case 'MODERATE':
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
    default:
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  }
}

export function NavigatePage() {
  const { user, socket } = useAuth();
  const { pushToast } = useToast();
  const [searchParams] = useSearchParams();
  const appliedQueryRef = useRef(false);

  const [nodes, setNodes] = useState<RoadNodeDTO[]>([]);
  const [segments, setSegments] = useState<RoadSegmentDTO[]>([]);
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);

  // Arbitrary Starting Location & Destination
  const [startLocation, setStartLocation] = useState<LocationPointDTO | null>({
    lat: 15.8405,
    lng: 74.492,
    label: 'Tilakwadi First Gate (Tilakwadi)',
    source: 'LOCAL_NODE',
    nodeId: 'node-tilakwadi',
    externalRef: 'N04',
  });
  const [destLocation, setDestLocation] = useState<LocationPointDTO | null>({
    lat: 15.8695,
    lng: 74.5025,
    label: 'KLE Medical Corridor (North Medical)',
    source: 'LOCAL_NODE',
    nodeId: 'node-kle',
    externalRef: 'N07',
  });

  const [startInput, setStartInput] = useState('Tilakwadi First Gate (Tilakwadi)');
  const [destInput, setDestInput] = useState('KLE Medical Corridor (North Medical)');
  const [startSuggestions, setStartSuggestions] = useState<ClientSuggestionItem[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<ClientSuggestionItem[]>([]);
  const [searchingStart, setSearchingStart] = useState(false);
  const [searchingDest, setSearchingDest] = useState(false);
  const [startFocused, setStartFocused] = useState(false);
  const [destFocused, setDestFocused] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [pickMode, setPickMode] = useState<'origin' | 'destination' | null>(null);

  const {
    isSdkReady,
    fetchPlaceSuggestions,
    resolvePlaceSuggestion,
    computeRoutesWithSdk,
  } = useGoogleMapsServices();

  const lastStartQueryRef = useRef<string>('');
  const lastDestQueryRef = useRef<string>('');

  const [routeResult, setRouteResult] = useState<RouteAlternativesResultDTO | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<RouteAlternativeDTO['category']>('RECOMMENDED');
  const [fitBoundsKey, setFitBoundsKey] = useState(0);
  const [savedRoutes, setSavedRoutes] = useState<Array<any>>([]);
  const [saveLabel, setSaveLabel] = useState('');

  // Configurable multi-factor weights
  const [distanceWeight, setDistanceWeight] = useState(0.18);
  const [timeWeight, setTimeWeight] = useState(0.32);
  const [congestionWeight, setCongestionWeight] = useState(0.22);
  const [incidentWeight, setIncidentWeight] = useState(0.16);

  const [loadingNetwork, setLoadingNetwork] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNetworkAndIncidents = useCallback(async () => {
    try {
      const [net, incs] = await Promise.all([
        routesApi.getNetwork(),
        incidentsApi.list({ status: 'VERIFIED' }),
      ]);
      setNodes(net.nodes);
      setSegments(net.segments);
      setIncidents(incs);
    } catch (err: any) {
      setError(err.message || 'Failed to load road network');
    } finally {
      setLoadingNetwork(false);
    }
  }, []);

  const calculate = useCallback(
    async (
      origin: LocationPointDTO | null = startLocation,
      dest: LocationPointDTO | null = destLocation
    ) => {
      if (!origin || !dest) {
        setError('Please select both a starting location and a destination before finding a route.');
        return;
      }
      if (
        Math.abs(origin.lat - dest.lat) < 0.0001 &&
        Math.abs(origin.lng - dest.lng) < 0.0001
      ) {
        setError('Starting location and destination cannot be the same point.');
        return;
      }

      setCalculating(true);
      setError(null);
      try {
        let res: RouteAlternativesResultDTO | null = null;

        if (isSdkReady) {
          const sdkCandidates = await computeRoutesWithSdk(
            { lat: origin.lat, lng: origin.lng },
            { lat: dest.lat, lng: dest.lng }
          );
          if (sdkCandidates && sdkCandidates.length > 0) {
            res = await routesApi.evaluateCandidates({
              originLat: origin.lat,
              originLng: origin.lng,
              originLabel: origin.label,
              originNodeId: origin.nodeId,
              destinationLat: dest.lat,
              destinationLng: dest.lng,
              destinationLabel: dest.label,
              destinationNodeId: dest.nodeId,
              distanceWeight,
              timeWeight,
              congestionWeight,
              incidentWeight,
              candidates: sdkCandidates,
            });
          }
        }

        if (!res) {
          res = await routesApi.getAlternatives({
            originLat: origin.lat,
            originLng: origin.lng,
            originLabel: origin.label,
            originNodeId: origin.nodeId,
            destinationLat: dest.lat,
            destinationLng: dest.lng,
            destinationLabel: dest.label,
            destinationNodeId: dest.nodeId,
            distanceWeight,
            timeWeight,
            congestionWeight,
            incidentWeight,
          });
        }

        setRouteResult(res);
        setSelectedCategory(
          res.alternatives.find((a) => a.isRecommended)?.category ||
            res.alternatives[0]?.category ||
            'RECOMMENDED'
        );
        setFitBoundsKey((k) => k + 1);
      } catch (err: any) {
        setRouteResult(null);
        setError(err.message || 'Unable to compute route alternatives');
      } finally {
        setCalculating(false);
      }
    },
    [
      startLocation,
      destLocation,
      distanceWeight,
      timeWeight,
      congestionWeight,
      incidentWeight,
      isSdkReady,
      computeRoutesWithSdk,
    ]
  );

  useEffect(() => {
    loadNetworkAndIncidents();
  }, [loadNetworkAndIncidents]);

  useEffect(() => {
    if (nodes.length === 0) return;

    const qOriginId = searchParams.get('originNodeId');
    const qDestId = searchParams.get('destinationNodeId');

    if (!appliedQueryRef.current && qOriginId && qDestId && qOriginId !== qDestId) {
      const oNode = nodes.find((n) => n.id === qOriginId);
      const dNode = nodes.find((n) => n.id === qDestId);
      if (oNode && dNode) {
        appliedQueryRef.current = true;
        const oPt: LocationPointDTO = {
          lat: oNode.latitude,
          lng: oNode.longitude,
          label: `${oNode.name} (${oNode.zone})`,
          source: 'LOCAL_NODE',
          nodeId: oNode.id,
          externalRef: oNode.externalRef,
        };
        const dPt: LocationPointDTO = {
          lat: dNode.latitude,
          lng: dNode.longitude,
          label: `${dNode.name} (${dNode.zone})`,
          source: 'LOCAL_NODE',
          nodeId: dNode.id,
          externalRef: dNode.externalRef,
        };
        setStartLocation(oPt);
        setDestLocation(dPt);
        setStartInput(oPt.label);
        setDestInput(dPt.label);
        calculate(oPt, dPt);
        return;
      }
    }

    if (startLocation && destLocation && !routeResult) {
      calculate(startLocation, destLocation);
    }
  }, [nodes.length, searchParams]);

  useEffect(() => {
    if (user) {
      routesApi
        .listSaved()
        .then(setSavedRoutes)
        .catch(() => setSavedRoutes([]));
    } else {
      setSavedRoutes([]);
    }
  }, [user]);

  // Realtime Socket.IO recalculation when verified incidents or road closures change
  useEffect(() => {
    if (!socket) return;
    const handleNetworkUpdate = () => {
      loadNetworkAndIncidents();
      if (startLocation && destLocation) {
        calculate(startLocation, destLocation);
      }
    };
    socket.on('incident:verified', handleNetworkUpdate);
    socket.on('incident:resolved', handleNetworkUpdate);
    socket.on('road:status-changed', handleNetworkUpdate);
    return () => {
      socket.off('incident:verified', handleNetworkUpdate);
      socket.off('incident:resolved', handleNetworkUpdate);
      socket.off('road:status-changed', handleNetworkUpdate);
    };
  }, [socket, loadNetworkAndIncidents, calculate, startLocation, destLocation]);

  const searchSuggestionsForSlot = useCallback(
    async (trimmed: string, slot: 'origin' | 'destination'): Promise<ClientSuggestionItem[]> => {
      const lower = trimmed.toLowerCase();
      const localMatches: ClientSuggestionItem[] = nodes
        .filter(
          (n) =>
            n.name.toLowerCase().includes(lower) ||
            n.zone.toLowerCase().includes(lower) ||
            n.externalRef.toLowerCase().includes(lower)
        )
        .slice(0, 4)
        .map((n) => ({
          id: n.id,
          name: n.name,
          displayName: `${n.name} (${n.zone} · TRAFFIX Corridor)`,
          latitude: n.latitude,
          longitude: n.longitude,
          source: 'LOCAL_NODE' as const,
          nodeId: n.id,
          externalRef: n.externalRef,
          zone: n.zone,
        }));

      const isCoord = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.test(trimmed);
      if (isSdkReady && !isCoord) {
        const gSuggestions = await fetchPlaceSuggestions(trimmed, slot);
        if (gSuggestions && gSuggestions.length > 0) {
          return [...localMatches, ...gSuggestions].slice(0, 8);
        }
      }

      const res = await routesApi.geocode(trimmed);
      return res.results;
    },
    [nodes, isSdkReady, fetchPlaceSuggestions]
  );

  // Debounced search for Starting Location using Google Places AutocompleteSuggestion
  useEffect(() => {
    const trimmed = startInput.trim();
    if (!startFocused || trimmed.length < 2) {
      return;
    }
    if (startLocation && trimmed === startLocation.label) {
      return;
    }
    if (trimmed === lastStartQueryRef.current) {
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingStart(true);
      try {
        lastStartQueryRef.current = trimmed;
        const results = await searchSuggestionsForSlot(trimmed, 'origin');
        setStartSuggestions(results);
      } catch {
        setStartSuggestions([]);
      } finally {
        setSearchingStart(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [startInput, startFocused, startLocation, searchSuggestionsForSlot]);

  // Debounced search for Destination using Google Places AutocompleteSuggestion
  useEffect(() => {
    const trimmed = destInput.trim();
    if (!destFocused || trimmed.length < 2) {
      return;
    }
    if (destLocation && trimmed === destLocation.label) {
      return;
    }
    if (trimmed === lastDestQueryRef.current) {
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingDest(true);
      try {
        lastDestQueryRef.current = trimmed;
        const results = await searchSuggestionsForSlot(trimmed, 'destination');
        setDestSuggestions(results);
      } catch {
        setDestSuggestions([]);
      } finally {
        setSearchingDest(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [destInput, destFocused, destLocation, searchSuggestionsForSlot]);

  const handleManualSearch = async (target: 'origin' | 'destination') => {
    const query = (target === 'origin' ? startInput : destInput).trim();
    if (query.length < 2) {
      pushToast({
        variant: 'info',
        title: 'Enter at least 2 characters',
        message: 'Type a street, landmark, city, or lat, lng coordinates.',
      });
      return;
    }
    if (target === 'origin') setSearchingStart(true);
    else setSearchingDest(true);
    try {
      const results = await searchSuggestionsForSlot(query, target);
      if (target === 'origin') {
        lastStartQueryRef.current = query;
        setStartSuggestions(results);
        setStartFocused(true);
      } else {
        lastDestQueryRef.current = query;
        setDestSuggestions(results);
        setDestFocused(true);
      }
      if (results.length === 0) {
        pushToast({
          variant: 'info',
          title: 'Location Not Found',
          message: 'No places matched that query. Try a broader place name or pick on the map.',
        });
      }
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Search Failed', message: err.message });
    } finally {
      if (target === 'origin') setSearchingStart(false);
      else setSearchingDest(false);
    }
  };

  const selectSuggestion = async (target: 'origin' | 'destination', s: ClientSuggestionItem) => {
    let resolved: GeocodeSuggestionDTO = s;
    if (s.placePrediction) {
      const fetched = await resolvePlaceSuggestion(s, target);
      if (!fetched) {
        pushToast({
          variant: 'error',
          title: 'Place Details Unavailable',
          message: 'Could not resolve coordinates for the selected place. Try another query or pick on the map.',
        });
        return;
      }
      resolved = fetched;
    }

    const pt: LocationPointDTO = {
      lat: resolved.latitude,
      lng: resolved.longitude,
      label: resolved.displayName || resolved.name,
      source: resolved.source === 'LOCAL_NODE' ? 'LOCAL_NODE' : 'GOOGLE_PLACES',
      nodeId: resolved.nodeId,
      externalRef: resolved.externalRef,
    };
    if (target === 'origin') {
      setStartLocation(pt);
      setStartInput(pt.label);
      setStartSuggestions([]);
      setStartFocused(false);
    } else {
      setDestLocation(pt);
      setDestInput(pt.label);
      setDestSuggestions([]);
      setDestFocused(false);
    }
    setError(null);
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      pushToast({
        variant: 'error',
        title: 'Geolocation Unsupported',
        message: 'Your browser does not support current-location lookup.',
      });
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        let label = `Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
        let nodeId: string | undefined;
        try {
          const rev = await routesApi.reverseGeocode(lat, lng);
          label = `My Location · ${rev.label}`;
          nodeId = rev.nearestNodeId;
        } catch {
          // keep coordinate label
        }
        const pt: LocationPointDTO = {
          lat,
          lng,
          label,
          source: 'GEOLOCATION',
          nodeId,
        };
        setStartLocation(pt);
        setStartInput(label);
        setStartSuggestions([]);
        setLocatingGps(false);
        setError(null);
        pushToast({ variant: 'success', title: 'Current Location Set', message: label });
      },
      (geoErr) => {
        setLocatingGps(false);
        pushToast({
          variant: 'error',
          title: 'Location Permission Denied',
          message:
            geoErr.message ||
            'Allow location access in browser settings or select a starting point on the map.',
        });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleMapClick = async (lat: number, lng: number) => {
    if (!pickMode) return;
    const mode = pickMode;
    setPickMode(null);

    let label = `Map Pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    let nodeId: string | undefined;
    try {
      const rev = await routesApi.reverseGeocode(lat, lng);
      label = rev.label;
      nodeId = rev.nearestNodeId;
    } catch {
      // keep fallback pin label
    }

    const pt: LocationPointDTO = {
      lat,
      lng,
      label,
      source: 'MAP_CLICK',
      nodeId,
    };

    if (mode === 'origin') {
      setStartLocation(pt);
      setStartInput(label);
      setStartSuggestions([]);
    } else {
      setDestLocation(pt);
      setDestInput(label);
      setDestSuggestions([]);
    }
    setError(null);
    pushToast({
      variant: 'info',
      title: mode === 'origin' ? 'Starting Location Selected' : 'Destination Selected',
      message: label,
    });
  };

  const handleSwapLocations = () => {
    const prevStart = startLocation;
    const prevDest = destLocation;
    const prevStartText = startInput;
    const prevDestText = destInput;

    setStartLocation(prevDest);
    setDestLocation(prevStart);
    setStartInput(prevDestText);
    setDestInput(prevStartText);
    setStartSuggestions([]);
    setDestSuggestions([]);
    setError(null);

    if (prevDest && prevStart) {
      calculate(prevDest, prevStart);
    }
  };

  const handleClearLocations = () => {
    setStartLocation(null);
    setDestLocation(null);
    setStartInput('');
    setDestInput('');
    setStartSuggestions([]);
    setDestSuggestions([]);
    setPickMode(null);
    setRouteResult(null);
    setError(null);
  };

  const activeRoute =
    routeResult?.alternatives.find((a) => a.category === selectedCategory) ||
    routeResult?.alternatives[0] ||
    null;

  const handleSaveRoute = async () => {
    if (!user) {
      pushToast({ variant: 'info', title: 'Sign In Required', message: 'Sign in to save routes.' });
      return;
    }
    if (!activeRoute || !startLocation || !destLocation) return;
    try {
      const label =
        saveLabel.trim() || `${startLocation.label.split(',')[0]} → ${destLocation.label.split(',')[0]}`;
      await routesApi.saveRoute({
        label,
        originNodeId: startLocation.nodeId,
        destinationNodeId: destLocation.nodeId,
        originLat: startLocation.lat,
        originLng: startLocation.lng,
        destinationLat: destLocation.lat,
        destinationLng: destLocation.lng,
        routeType: activeRoute.category,
        summary: {
          distanceKm: activeRoute.totalDistanceKm,
          etaMin: activeRoute.estimatedTimeMin,
          originLat: startLocation.lat,
          originLng: startLocation.lng,
          originLabel: startLocation.label,
          destinationLat: destLocation.lat,
          destinationLng: destLocation.lng,
          destinationLabel: destLocation.label,
        },
      });
      setSaveLabel('');
      const updated = await routesApi.listSaved();
      setSavedRoutes(updated);
      pushToast({ variant: 'success', title: 'Route Saved', message: label });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Save Failed', message: err.message });
    }
  };

  const mapOverlays = (routeResult?.alternatives || []).map((alt) => ({
    id: alt.category,
    label: `${alt.routeName || alt.category} (${alt.estimatedTimeMin}m / ${alt.totalDistanceKm}km)`,
    geometry: alt.geometry,
    color:
      alt.category === selectedCategory
        ? '#2563EB'
        : alt.intersectsClosedRoad
        ? '#EF4444'
        : alt.category === 'SHORTEST'
        ? '#7C3AED'
        : '#64748B',
    dashed: alt.category !== selectedCategory,
    weight: alt.category === selectedCategory ? 7 : 4,
    trafficStatus: alt.trafficLevel || 'SIMULATED',
  }));

  const localQuickSuggestions: GeocodeSuggestionDTO[] = nodes.slice(0, 6).map((n) => ({
    id: n.id,
    name: n.name,
    displayName: `${n.name} (${n.zone} · TRAFFIX Corridor)`,
    latitude: n.latitude,
    longitude: n.longitude,
    source: 'LOCAL_NODE',
    nodeId: n.id,
    externalRef: n.externalRef,
    zone: n.zone,
  }));

  return (
    <WorkspaceLayout
      title="Smart Navigation & Multi-Factor Route Optimizer"
      breadcrumb="Navigate"
      actions={
        <button
          type="button"
          onClick={() => {
            loadNetworkAndIncidents();
            if (startLocation && destLocation) {
              calculate(startLocation, destLocation);
            }
          }}
          disabled={calculating}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0D1424] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${calculating ? 'animate-spin' : ''}`} />
          <span>Recalculate</span>
        </button>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Controls & Route Alternatives */}
        <div className="xl:col-span-5 space-y-5">
          {/* Origin & Destination Selection Card */}
          <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white">Location & Route Planner</h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSwapLocations}
                  title="Swap start and destination"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#090E1A] px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                >
                  <ArrowUpDown className="w-3 h-3" />
                  <span>Swap</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearLocations}
                  title="Clear starting location and destination"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#090E1A] px-2.5 py-1 text-[11px] text-slate-300 hover:text-red-300 hover:border-red-500/40"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Starting Location Input */}
            <div className="relative space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-emerald-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Starting Location</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleUseCurrentLocation}
                    disabled={locatingGps}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600/20 px-2 py-0.5 text-[11px] text-emerald-300 hover:bg-emerald-600/35 disabled:opacity-50"
                  >
                    <LocateFixed className="w-3 h-3" />
                    <span>{locatingGps ? 'Locating...' : 'Use Current'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickMode(pickMode === 'origin' ? null : 'origin')}
                    className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors ${
                      pickMode === 'origin'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>{pickMode === 'origin' ? 'Cancel Pick' : 'Pick on Map'}</span>
                  </button>
                </div>
              </div>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={startInput}
                  onFocus={() => {
                    setStartFocused(true);
                    if (startSuggestions.length === 0 && startInput.trim().length < 2) {
                      setStartSuggestions(localQuickSuggestions);
                    }
                  }}
                  onBlur={() => setTimeout(() => setStartFocused(false), 180)}
                  onChange={(e) => {
                    setStartInput(e.target.value);
                    if (startLocation && e.target.value !== startLocation.label) {
                      setStartLocation(null);
                    }
                  }}
                  placeholder="Search place, address, landmark, or lat, lng..."
                  className="flex-1 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleManualSearch('origin')}
                  disabled={searchingStart}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              </div>

              {startLocation && (
                <p className="text-[11px] font-mono text-slate-400">
                  Selected: {startLocation.lat.toFixed(5)}, {startLocation.lng.toFixed(5)} ·{' '}
                  {startLocation.source}
                </p>
              )}

              {startFocused && (searchingStart || startSuggestions.length > 0) && (
                <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-[#090E1A] shadow-xl">
                  {searchingStart ? (
                    <div className="px-3 py-2 text-xs text-slate-400">
                      Searching Google Places...
                    </div>
                  ) : (
                    startSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion('origin', s);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800 border-b border-slate-800/70 last:border-0"
                      >
                        <div className="font-medium text-white truncate">{s.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {s.displayName} · {s.source}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Destination Input */}
            <div className="relative space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-rose-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Destination</span>
                </label>
                <button
                  type="button"
                  onClick={() => setPickMode(pickMode === 'destination' ? null : 'destination')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors ${
                    pickMode === 'destination'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <Crosshair className="w-3 h-3" />
                  <span>{pickMode === 'destination' ? 'Cancel Pick' : 'Pick on Map'}</span>
                </button>
              </div>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={destInput}
                  onFocus={() => {
                    setDestFocused(true);
                    if (destSuggestions.length === 0 && destInput.trim().length < 2) {
                      setDestSuggestions(localQuickSuggestions);
                    }
                  }}
                  onBlur={() => setTimeout(() => setDestFocused(false), 180)}
                  onChange={(e) => {
                    setDestInput(e.target.value);
                    if (destLocation && e.target.value !== destLocation.label) {
                      setDestLocation(null);
                    }
                  }}
                  placeholder="Search destination place, address, or lat, lng..."
                  className="flex-1 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-sm text-white focus:border-rose-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleManualSearch('destination')}
                  disabled={searchingDest}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
              </div>

              {destLocation && (
                <p className="text-[11px] font-mono text-slate-400">
                  Selected: {destLocation.lat.toFixed(5)}, {destLocation.lng.toFixed(5)} ·{' '}
                  {destLocation.source}
                </p>
              )}

              {destFocused && (searchingDest || destSuggestions.length > 0) && (
                <div className="absolute left-0 right-0 z-30 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-[#090E1A] shadow-xl">
                  {searchingDest ? (
                    <div className="px-3 py-2 text-xs text-slate-400">
                      Searching Google Places...
                    </div>
                  ) : (
                    destSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion('destination', s);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800 border-b border-slate-800/70 last:border-0"
                      >
                        <div className="font-medium text-white truncate">{s.name}</div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {s.displayName} · {s.source}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Configurable Weights */}
            <div className="border-t border-slate-800 pt-3 space-y-2.5">
              <p className="text-xs font-medium text-slate-400">
                Multi-Factor Recommendation Weights
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="flex justify-between text-slate-300">
                    <span>Distance</span>
                    <span className="font-mono">{distanceWeight.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.6"
                    step="0.02"
                    value={distanceWeight}
                    onChange={(e) => setDistanceWeight(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="flex justify-between text-slate-300">
                    <span>Travel Time</span>
                    <span className="font-mono">{timeWeight.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.6"
                    step="0.02"
                    value={timeWeight}
                    onChange={(e) => setTimeWeight(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="flex justify-between text-slate-300">
                    <span>Congestion</span>
                    <span className="font-mono">{congestionWeight.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.6"
                    step="0.02"
                    value={congestionWeight}
                    onChange={(e) => setCongestionWeight(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="flex justify-between text-slate-300">
                    <span>Incident Penalty</span>
                    <span className="font-mono">{incidentWeight.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="0.6"
                    step="0.02"
                    value={incidentWeight}
                    onChange={(e) => setIncidentWeight(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </label>
              </div>
            </div>

            <button
              type="button"
              onClick={() => calculate(startLocation, destLocation)}
              disabled={calculating || loadingNetwork || !startLocation || !destLocation}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              <span>{calculating ? 'Calculating Road Route...' : 'Find Route'}</span>
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Route Comparison Panel */}
          {routeResult && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-800 bg-[#0D1424] px-3.5 py-2.5 text-xs space-y-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span>
                    Engine: <span className="font-mono text-cyan-400">{routeResult.provider.mode}</span>
                  </span>
                  <span className="font-mono text-slate-400">
                    {routeResult.activeClosuresCount} closures · {routeResult.activeSimulationsCount} sims
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">{routeResult.provider.notice}</p>
              </div>

              {routeResult.alternatives.map((alt) => {
                const isSelected = selectedCategory === alt.category;
                const closureWarnings = alt.closureWarnings || [];
                const incidentCount = alt.incidentCount ?? alt.relevantIncidents.length;
                return (
                  <button
                    key={alt.category}
                    type="button"
                    onClick={() => setSelectedCategory(alt.category)}
                    className={`w-full text-left rounded-xl border p-4 transition-colors space-y-2 ${
                      isSelected
                        ? 'border-blue-500 bg-blue-950/25'
                        : 'border-slate-800/80 bg-[#0D1424] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-white truncate">
                          {alt.routeName ||
                            (alt.category === 'RECOMMENDED'
                              ? 'Recommended Smart Route'
                              : alt.category === 'FASTEST'
                              ? 'Fastest Route'
                              : 'Shortest Distance Route')}
                        </span>
                        {alt.isRecommended && (
                          <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300 shrink-0">
                            RECOMMENDED
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-sm font-semibold text-cyan-300 tabular-nums shrink-0">
                        {alt.estimatedTimeMin} min · {alt.totalDistanceKm} km
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{alt.explanation}</p>

                    {closureWarnings.length > 0 && (
                      <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-950/25 px-2.5 py-1.5 text-[11px] text-amber-200">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                        <span>{closureWarnings.join(' · ')}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-mono text-slate-300 tabular-nums">
                      <span
                        className={`rounded border px-1.5 py-0.5 ${formatTrafficBadge(
                          alt.trafficLevel
                        )}`}
                      >
                        {alt.trafficLevel || 'CLEAR'} ({Math.round(alt.avgCongestion * 100)}%)
                      </span>
                      <span>Incidents: {incidentCount}</span>
                      <span>Fuel: {alt.estimatedFuelLiters} L</span>
                      <span>Reliability: {Math.round(alt.reliabilityScore * 100)}%</span>
                      <span>Score: {alt.scoreBreakdown.totalCompositeScore}</span>
                    </div>
                  </button>
                );
              })}

              {/* Side-by-Side Comparison Matrix */}
              {routeResult.alternatives.length > 0 && (
                <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] overflow-hidden">
                  <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      Route Comparison Matrix
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      Click row to inspect
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#090E1A] text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="px-3 py-2 font-medium">Rank</th>
                          <th className="px-3 py-2 font-medium text-right">Dist</th>
                          <th className="px-3 py-2 font-medium text-right">ETA</th>
                          <th className="px-3 py-2 font-medium text-right">Load</th>
                          <th className="px-3 py-2 font-medium text-right">Fuel</th>
                          <th className="px-3 py-2 font-medium text-right">Rel</th>
                          <th className="px-3 py-2 font-medium text-right">Issues</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                        {routeResult.alternatives.map((alt) => {
                          const active = selectedCategory === alt.category;
                          const issuesCount =
                            (alt.incidentCount ?? alt.relevantIncidents.length) +
                            (alt.closureWarnings?.length || 0);
                          return (
                            <tr
                              key={`cmp-${alt.category}`}
                              onClick={() => setSelectedCategory(alt.category)}
                              className={`cursor-pointer transition-colors ${
                                active ? 'bg-blue-950/35 text-white' : 'text-slate-300 hover:bg-slate-800/30'
                              }`}
                            >
                              <td className="px-3 py-2 font-sans font-medium text-white">
                                {alt.category}
                              </td>
                              <td className="px-3 py-2 text-right">{alt.totalDistanceKm} km</td>
                              <td className="px-3 py-2 text-right text-cyan-300">
                                {alt.estimatedTimeMin}m
                              </td>
                              <td className="px-3 py-2 text-right">
                                {Math.round(alt.avgCongestion * 100)}%
                              </td>
                              <td className="px-3 py-2 text-right">{alt.estimatedFuelLiters}L</td>
                              <td className="px-3 py-2 text-right text-emerald-400">
                                {Math.round(alt.reliabilityScore * 100)}%
                              </td>
                              <td className="px-3 py-2 text-right">
                                {issuesCount > 0 ? (
                                  <span className="text-amber-300">{issuesCount}</span>
                                ) : (
                                  '0'
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Save Selected Route */}
              {user && activeRoute && (
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={saveLabel}
                    onChange={(e) => setSaveLabel(e.target.value)}
                    placeholder="Label to save favourite route..."
                    className="flex-1 rounded-lg border border-slate-700 bg-[#090E1A] px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={handleSaveRoute}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1424] px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-blue-400" />
                    <span>Save Route</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Saved Routes */}
          {savedRoutes.length > 0 && (
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-4 space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-300">Saved Commuter Routes</h3>
              {savedRoutes.map((sr) => (
                <div
                  key={sr.id}
                  className="flex items-center justify-between gap-2 text-xs border-b border-slate-800/60 pb-2 last:border-0 last:pb-0"
                >
                  <button
                    type="button"
                    onClick={() => {
                      const summary = sr.summary || {};
                      if (
                        summary.originLat !== undefined &&
                        summary.originLng !== undefined &&
                        summary.destinationLat !== undefined &&
                        summary.destinationLng !== undefined
                      ) {
                        const oPt: LocationPointDTO = {
                          lat: Number(summary.originLat),
                          lng: Number(summary.originLng),
                          label: String(summary.originLabel || sr.originName),
                          source: 'LOCAL_NODE',
                          nodeId: sr.originNodeId,
                        };
                        const dPt: LocationPointDTO = {
                          lat: Number(summary.destinationLat),
                          lng: Number(summary.destinationLng),
                          label: String(summary.destinationLabel || sr.destinationName),
                          source: 'LOCAL_NODE',
                          nodeId: sr.destinationNodeId,
                        };
                        setStartLocation(oPt);
                        setDestLocation(dPt);
                        setStartInput(oPt.label);
                        setDestInput(dPt.label);
                        setSelectedCategory(sr.routeType);
                        calculate(oPt, dPt);
                      } else {
                        const oNode = nodes.find((n) => n.id === sr.originNodeId);
                        const dNode = nodes.find((n) => n.id === sr.destinationNodeId);
                        if (oNode && dNode) {
                          const oPt: LocationPointDTO = {
                            lat: oNode.latitude,
                            lng: oNode.longitude,
                            label: oNode.name,
                            source: 'LOCAL_NODE',
                            nodeId: oNode.id,
                          };
                          const dPt: LocationPointDTO = {
                            lat: dNode.latitude,
                            lng: dNode.longitude,
                            label: dNode.name,
                            source: 'LOCAL_NODE',
                            nodeId: dNode.id,
                          };
                          setStartLocation(oPt);
                          setDestLocation(dPt);
                          setStartInput(oPt.label);
                          setDestInput(dPt.label);
                          setSelectedCategory(sr.routeType);
                          calculate(oPt, dPt);
                        }
                      }
                    }}
                    className="text-left text-blue-300 hover:underline truncate"
                  >
                    {sr.label} ({sr.routeType})
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await routesApi.deleteSaved(sr.id);
                      setSavedRoutes(await routesApi.listSaved());
                    }}
                    className="text-slate-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Map & Selected Route Details */}
        <div className="xl:col-span-7 space-y-5">
          <TrafficMap
            nodes={nodes}
            segments={segments}
            incidents={incidents}
            routes={mapOverlays}
            startPoint={
              startLocation
                ? { lat: startLocation.lat, lng: startLocation.lng, label: startLocation.label }
                : null
            }
            endPoint={
              destLocation
                ? { lat: destLocation.lat, lng: destLocation.lng, label: destLocation.label }
                : null
            }
            highlightNodeIds={[
              startLocation?.nodeId || '',
              destLocation?.nodeId || '',
            ].filter(Boolean)}
            activeRouteSegmentIds={activeRoute?.pathSegmentIds || []}
            pickMode={pickMode}
            fitBoundsKey={fitBoundsKey}
            onMapClick={handleMapClick}
            onRouteSelect={(id) =>
              setSelectedCategory(id as RouteAlternativeDTO['category'])
            }
            onNodeSelect={(n) => {
              const pt: LocationPointDTO = {
                lat: n.latitude,
                lng: n.longitude,
                label: `${n.name} (${n.zone})`,
                source: 'LOCAL_NODE',
                nodeId: n.id,
                externalRef: n.externalRef,
              };
              if (pickMode === 'origin' || !startLocation) {
                setStartLocation(pt);
                setStartInput(pt.label);
                setPickMode(null);
              } else if (pickMode === 'destination' || !destLocation) {
                setDestLocation(pt);
                setDestInput(pt.label);
                setPickMode(null);
              }
            }}
            heightClass="h-[500px]"
          />

          {activeRoute && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Score Component Breakdown */}
              <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Multi-Factor Score Breakdown ({activeRoute.category})
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Distance Component</span>
                    <span className="font-mono text-slate-200">
                      +{activeRoute.scoreBreakdown.distanceWeight}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Travel Time Component</span>
                    <span className="font-mono text-slate-200">
                      +{activeRoute.scoreBreakdown.timeWeight}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Congestion Penalty (Simulated)</span>
                    <span className="font-mono text-amber-300">
                      +{activeRoute.scoreBreakdown.congestionPenalty}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Incident Penalty</span>
                    <span className="font-mono text-orange-300">
                      +{activeRoute.scoreBreakdown.incidentPenalty}
                    </span>
                  </div>
                  {activeRoute.scoreBreakdown.closurePenalty > 0 && (
                    <div className="flex justify-between">
                      <span className="text-red-300">Closed Road Penalty</span>
                      <span className="font-mono text-red-400">
                        +{activeRoute.scoreBreakdown.closurePenalty}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Fuel Estimate Penalty</span>
                    <span className="font-mono text-slate-200">
                      +{activeRoute.scoreBreakdown.fuelEstimatePenalty}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Reliability Benefit</span>
                    <span className="font-mono text-emerald-400">
                      -{activeRoute.scoreBreakdown.reliabilityBenefit}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-2 font-semibold">
                    <span className="text-white">Composite Cost Score (Lower is better)</span>
                    <span className="font-mono text-cyan-300">
                      {activeRoute.scoreBreakdown.totalCompositeScore}
                    </span>
                  </div>
                </div>
              </div>

              {/* Turn-by-Turn & Relevant Incidents */}
              <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white">
                  Turn-by-Turn Directions & Active Hazards
                </h3>
                <ol className="space-y-1.5 text-xs text-slate-300 max-h-52 overflow-y-auto pr-1">
                  {activeRoute.importantTurns.map((t, idx) => (
                    <li key={`${t.nodeId}-${idx}`} className="flex gap-2">
                      <span className="font-mono text-slate-500 w-5 shrink-0">{idx + 1}.</span>
                      <span>{t.instruction}</span>
                    </li>
                  ))}
                </ol>
                {activeRoute.relevantIncidents.length > 0 && (
                  <div className="border-t border-slate-800 pt-3 space-y-1.5">
                    <p className="text-xs font-medium text-amber-300">
                      Active Incidents on Corridor ({activeRoute.relevantIncidents.length})
                    </p>
                    {activeRoute.relevantIncidents.map((inc) => (
                      <p key={inc.id} className="text-xs text-slate-400">
                        {inc.type} · {inc.severity} — {inc.description}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
