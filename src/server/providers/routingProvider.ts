import Database from 'better-sqlite3';
import { env } from '../config/env.js';
import { GeocodeSuggestionDTO, RoadNodeDTO } from '../../shared/types.js';
import { haversineMeters } from '../algorithms/geo.js';

export interface ProviderMetadata {
  name: string;
  mode:
    | 'SIMULATED_GRAPH'
    | 'LIVE_FALLBACK_SIMULATED'
    | 'LIVE'
    | 'GOOGLE_ROUTES_WITH_SIMULATED_TRAFFIC'
    | 'OSRM_WITH_SIMULATED_TRAFFIC';
  isSimulated: boolean;
  lastUpdated: string;
  notice: string;
}

export interface RouteStepDTO {
  instruction: string;
  name: string;
  distanceMeters: number;
  durationSec: number;
  latitude: number;
  longitude: number;
}

export interface ExternalParsedRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: Array<[number, number]>; // [lat, lng]
  steps: RouteStepDTO[];
  summary: string;
}

// Short-lived in-memory caches for routing & place lookups
const geocodeCache = new Map<string, { expiresAt: number; items: GeocodeSuggestionDTO[] }>();
const reverseCache = new Map<string, { expiresAt: number; label: string }>();
const routeCache = new Map<string, { expiresAt: number; routes: ExternalParsedRoute[] }>();

function isExternalNetworkAllowed(): boolean {
  if (process.env.TRAFFIX_DISABLE_EXTERNAL === 'true') return false;
  if (process.env.VITEST === 'true' && process.env.TRAFFIX_TEST_FETCH !== 'true') {
    return false;
  }
  return true;
}

function getServerMapsKey(): string {
  const k = (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    env.googleMapsApiKey ||
    ''
  ).trim();
  if (!k || k === 'YOUR_API_KEY' || k === 'MY_GOOGLE_MAPS_API_KEY') return '';
  return k;
}

export function decodePolyline(encoded: string): Array<[number, number]> {
  if (!encoded) return [];
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([Number((lat / 1e5).toFixed(6)), Number((lng / 1e5).toFixed(6))]);
  }
  return points;
}

function parseDurationSeconds(durationStr: unknown): number {
  if (typeof durationStr === 'number' && Number.isFinite(durationStr)) {
    return durationStr;
  }
  if (typeof durationStr === 'string') {
    const match = durationStr.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return Number(match[1]);
  }
  return 0;
}

export function getRoutingProviderMetadata(
  overrideMode?: ProviderMetadata['mode'],
  overrideNotice?: string
): ProviderMetadata {
  if (overrideMode === 'GOOGLE_ROUTES_WITH_SIMULATED_TRAFFIC') {
    return {
      name: 'Google Maps Routes API + TRAFFIX Simulated Traffic Overlay',
      mode: 'GOOGLE_ROUTES_WITH_SIMULATED_TRAFFIC',
      isSimulated: true,
      lastUpdated: new Date().toISOString(),
      notice:
        overrideNotice ||
        'Real road geometry & distances via Google Routes API; congestion, incidents, and closure penalties use SIMULATED TRAFFIC DATA.',
    };
  }
  if (overrideMode === 'LIVE_FALLBACK_SIMULATED') {
    return {
      name: 'TRAFFIX Local Road Graph Fallback',
      mode: 'LIVE_FALLBACK_SIMULATED',
      isSimulated: true,
      lastUpdated: new Date().toISOString(),
      notice:
        overrideNotice ||
        'Using deterministic local road-graph fallback snapped to nearest TRAFFIX corridor intersections.',
    };
  }

  const hasLiveConfig = Boolean(
    getServerMapsKey() || (env.liveRoutingApiUrl && env.liveRoutingApiKey)
  );
  if (!hasLiveConfig) {
    return {
      name: 'TRAFFIX Deterministic Road Graph Engine',
      mode: 'SIMULATED_GRAPH',
      isSimulated: true,
      lastUpdated: new Date().toISOString(),
      notice:
        overrideNotice ||
        'SIMULATED DATA: Using seeded city road graph and deterministic congestion profile.',
    };
  }
  return {
    name: 'Google Maps Platform + TRAFFIX Graph Engine',
    mode: 'LIVE_FALLBACK_SIMULATED',
    isSimulated: true,
    lastUpdated: new Date().toISOString(),
    notice:
      overrideNotice ||
      'Google Maps Platform integration enabled; deterministic graph fallback available for local node routing.',
  };
}

export function findNearestRoadNode(
  db: Database.Database,
  lat: number,
  lng: number
): { node: RoadNodeDTO; distanceMeters: number } | null {
  const allNodes = db.prepare('SELECT * FROM road_nodes').all() as Array<any>;
  if (allNodes.length === 0) return null;

  let best: RoadNodeDTO | null = null;
  let bestDist = Infinity;
  for (const r of allNodes) {
    const d = haversineMeters(lat, lng, r.latitude, r.longitude);
    if (d < bestDist) {
      bestDist = d;
      best = {
        id: r.id,
        externalRef: r.external_ref,
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
        isJunction: Boolean(r.is_junction),
        zone: r.zone,
      };
    }
  }
  return best ? { node: best, distanceMeters: bestDist } : null;
}

export function geocodePlaceOrCoords(
  db: Database.Database,
  query: string
): Array<RoadNodeDTO & { matchType: 'NAME_MATCH' | 'COORDINATE_SNAP' }> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const coordMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const allNodes = db.prepare('SELECT * FROM road_nodes').all() as Array<any>;

  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return allNodes
        .map((r) => ({
          id: r.id,
          externalRef: r.external_ref,
          name: r.name,
          latitude: r.latitude,
          longitude: r.longitude,
          isJunction: Boolean(r.is_junction),
          zone: r.zone,
          dist: haversineMeters(lat, lng, r.latitude, r.longitude),
          matchType: 'COORDINATE_SNAP' as const,
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3)
        .map(({ dist: _d, ...rest }) => rest);
    }
  }

  const lower = trimmed.toLowerCase();
  return allNodes
    .filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.zone.toLowerCase().includes(lower) ||
        r.external_ref.toLowerCase().includes(lower)
    )
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      externalRef: r.external_ref,
      name: r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      isJunction: Boolean(r.is_junction),
      zone: r.zone,
      matchType: 'NAME_MATCH' as const,
    }));
}

function mergeSuggestions(
  local: GeocodeSuggestionDTO[],
  external: GeocodeSuggestionDTO[]
): GeocodeSuggestionDTO[] {
  const combined: GeocodeSuggestionDTO[] = [...local];
  for (const ext of external) {
    const dup = combined.some(
      (c) => haversineMeters(c.latitude, c.longitude, ext.latitude, ext.longitude) < 80
    );
    if (!dup) combined.push(ext);
  }
  return combined.slice(0, 8);
}

export async function searchLocations(
  db: Database.Database,
  query: string
): Promise<GeocodeSuggestionDTO[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // 1. Direct lat, lng input
  const coordMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number(coordMatch[1]);
    const lng = Number(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      const localSnaps = geocodePlaceOrCoords(db, trimmed).map((n) => ({
        id: n.id,
        name: n.name,
        displayName: `${n.name} (${n.zone} · Local Node ${n.externalRef})`,
        latitude: n.latitude,
        longitude: n.longitude,
        source: 'LOCAL_NODE' as const,
        nodeId: n.id,
        externalRef: n.externalRef,
        zone: n.zone,
      }));
      return [
        {
          id: `coord-${lat.toFixed(5)}-${lng.toFixed(5)}`,
          name: `Coordinates (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
          displayName: `Exact Coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          latitude: lat,
          longitude: lng,
          source: 'COORDINATE',
        },
        ...localSnaps,
      ];
    }
  }

  // 2. Local seeded nodes matching query
  const localMatches: GeocodeSuggestionDTO[] = geocodePlaceOrCoords(db, trimmed).map((n) => ({
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

  const apiKey = getServerMapsKey();
  if (trimmed.length < 2 || !isExternalNetworkAllowed() || !apiKey) {
    return localMatches;
  }

  const cacheKey = trimmed.toLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return mergeSuggestions(localMatches, cached.items);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: trimmed,
        maxResultCount: 6,
        locationBias: {
          circle: {
            center: { latitude: 15.853, longitude: 74.502 },
            radius: 30000.0,
          },
        },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      return localMatches;
    }

    const data = (await res.json()) as { places?: Array<any> };
    const placesSuggestions: GeocodeSuggestionDTO[] = (Array.isArray(data?.places) ? data.places : [])
      .map((item) => {
        const lat = Number(item?.location?.latitude);
        const lng = Number(item?.location?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const name = item?.displayName?.text || item?.formattedAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        return {
          id: `gplace-${item.id || `${lat.toFixed(5)}-${lng.toFixed(5)}`}`,
          placeId: item.id,
          name,
          displayName: item.formattedAddress || name,
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6)),
          source: 'GOOGLE_PLACES' as const,
        };
      })
      .filter(Boolean) as GeocodeSuggestionDTO[];

    geocodeCache.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      items: placesSuggestions,
    });

    return mergeSuggestions(localMatches, placesSuggestions);
  } catch {
    return localMatches;
  }
}

export async function reverseGeocodeCoords(
  db: Database.Database,
  lat: number,
  lng: number
): Promise<{
  label: string;
  latitude: number;
  longitude: number;
  source: 'LOCAL_NODE' | 'GOOGLE_PLACES' | 'COORDINATE';
  nearestNodeId?: string;
}> {
  const nearest = findNearestRoadNode(db, lat, lng);
  if (nearest && nearest.distanceMeters <= 90) {
    return {
      label: `${nearest.node.name} (${nearest.node.zone})`,
      latitude: lat,
      longitude: lng,
      source: 'LOCAL_NODE',
      nearestNodeId: nearest.node.id,
    };
  }

  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = reverseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      label: cached.label,
      latitude: lat,
      longitude: lng,
      source: 'GOOGLE_PLACES',
      nearestNodeId: nearest?.node.id,
    };
  }

  const apiKey = getServerMapsKey();
  if (isExternalNetworkAllowed() && apiKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(
        apiKey
      )}`;
      const res = await fetch(url, { signal: controller.signal }).finally(() =>
        clearTimeout(timer)
      );
      if (res.ok) {
        const data = (await res.json()) as { status?: string; results?: Array<any> };
        const formatted = data?.results?.[0]?.formatted_address;
        if (data?.status === 'OK' && typeof formatted === 'string' && formatted.trim()) {
          const label = formatted.split(',').slice(0, 3).join(',').trim();
          reverseCache.set(cacheKey, { expiresAt: Date.now() + 10 * 60 * 1000, label });
          return {
            label,
            latitude: lat,
            longitude: lng,
            source: 'GOOGLE_PLACES',
            nearestNodeId: nearest?.node.id,
          };
        }
      }
    } catch {
      // fall through cleanly to deterministic local coordinate label
    }
  }

  const fallbackLabel =
    nearest && nearest.distanceMeters <= 2500
      ? `Near ${nearest.node.name} (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      : `Pinned Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;

  return {
    label: fallbackLabel,
    latitude: lat,
    longitude: lng,
    source: 'COORDINATE',
    nearestNodeId: nearest?.node.id,
  };
}

export async function fetchGoogleRoutes(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: Array<{ lat: number; lng: number }> = []
): Promise<
  | { ok: true; routes: ExternalParsedRoute[] }
  | { ok: false; error: string; quotaExceeded?: boolean }
> {
  if (!isExternalNetworkAllowed()) {
    return { ok: false, error: 'External routing disabled in test mode' };
  }

  const apiKey = getServerMapsKey();
  if (!apiKey && process.env.TRAFFIX_TEST_FETCH !== 'true') {
    return { ok: false, error: 'Server Google Maps API key is not configured' };
  }

  const cacheKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}->${destination.lat.toFixed(
    5
  )},${destination.lng.toFixed(5)}|wp=${waypoints
    .map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`)
    .join(';')}`;

  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, routes: cached.routes };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const body: Record<string, unknown> = {
      origin: {
        location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
      },
      destination: {
        location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: waypoints.length === 0,
      languageCode: 'en-US',
      units: 'METRIC',
    };

    if (waypoints.length > 0) {
      body.intermediates = waypoints.map((w) => ({
        location: { latLng: { latitude: w.lat, longitude: w.lng } },
      }));
    }

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey || 'test-key',
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.description,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.legs.steps.startLocation',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      let quotaExceeded = res.status === 429;
      let errMsg = `Google Routes API HTTP ${res.status}`;
      try {
        const errJson = (await res.json()) as any;
        if (errJson?.error?.status === 'RESOURCE_EXHAUSTED') quotaExceeded = true;
        if (errJson?.error?.message) errMsg = errJson.error.message;
      } catch {
        // ignore JSON parse error
      }
      return { ok: false, error: errMsg, quotaExceeded };
    }

    const data = (await res.json()) as { routes?: Array<any> };
    if (!Array.isArray(data?.routes) || data.routes.length === 0) {
      return { ok: false, error: 'Google Routes API returned no routes' };
    }

    const parsed: ExternalParsedRoute[] = data.routes.map((rt: any, idx: number) => {
      const encoded = rt?.polyline?.encodedPolyline;
      const geometry =
        typeof encoded === 'string' && encoded.length > 0
          ? decodePolyline(encoded)
          : Array.isArray(rt?.geometry?.coordinates)
          ? (rt.geometry.coordinates as Array<[number, number]>).map(
              ([lng, lat]): [number, number] => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]
            )
          : [];

      const steps: RouteStepDTO[] = [];
      for (const leg of rt.legs || []) {
        for (const st of leg.steps || []) {
          const instr = st?.navigationInstruction?.instructions || 'Continue along route';
          const latLng = st?.startLocation?.latLng;
          steps.push({
            instruction: String(instr),
            name: String(st?.navigationInstruction?.maneuver || 'Route Step'),
            distanceMeters: Math.round(Number(st?.distanceMeters || 0)),
            durationSec: Math.round(parseDurationSeconds(st?.staticDuration)),
            latitude: Number(latLng?.latitude ?? origin.lat),
            longitude: Number(latLng?.longitude ?? origin.lng),
          });
        }
      }

      return {
        distanceMeters: Number(rt.distanceMeters || 0),
        durationSeconds: parseDurationSeconds(rt.duration),
        geometry,
        steps,
        summary: rt.description ? String(rt.description) : `Google Road Route ${idx + 1}`,
      };
    });

    routeCache.set(cacheKey, { expiresAt: Date.now() + 60 * 1000, routes: parsed });
    return { ok: true, routes: parsed };
  } catch (err: any) {
    return {
      ok: false,
      error:
        err?.name === 'AbortError'
          ? 'Google Routes API request timed out'
          : err?.message || 'Google Routes API failed',
    };
  } finally {
    clearTimeout(timer);
  }
}
