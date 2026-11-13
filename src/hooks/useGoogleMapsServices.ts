import { useCallback, useContext, useRef } from 'react';
import { APILoadingStatus, APIProviderContext } from '@vis.gl/react-google-maps';
import { dispatchGmpQuotaExceeded, isQuotaError } from '../config/maps';
import { useMapsStatus } from '../context/MapsContext';
import { GeocodeSuggestionDTO } from '../shared/types';

export interface GoogleRouteCandidatePayload {
  distanceMeters: number;
  durationSeconds: number;
  geometry: Array<[number, number]>;
  summary?: string;
  steps?: Array<{
    instruction: string;
    name?: string;
    distanceMeters?: number;
    durationSec?: number;
    latitude: number;
    longitude: number;
  }>;
}

export interface ClientSuggestionItem extends GeocodeSuggestionDTO {
  placePrediction?: google.maps.places.PlacePrediction;
}

export function useGoogleMapsServices() {
  const apiContext = useContext(APIProviderContext);
  const { hasApiKey, loadingStatus, authFailureMessage } = useMapsStatus();

  const originSessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const destSessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const isSdkReady =
    hasApiKey &&
    !authFailureMessage &&
    Boolean(apiContext) &&
    loadingStatus === APILoadingStatus.LOADED;

  const fetchPlaceSuggestions = useCallback(
    async (
      query: string,
      sessionSlot: 'origin' | 'destination' = 'origin'
    ): Promise<ClientSuggestionItem[] | null> => {
      if (!isSdkReady || !apiContext) return null;
      try {
        const placesLib = (await apiContext.importLibrary(
          'places'
        )) as google.maps.PlacesLibrary;
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        const tokenRef =
          sessionSlot === 'origin' ? originSessionTokenRef : destSessionTokenRef;
        if (!tokenRef.current) {
          tokenRef.current = new AutocompleteSessionToken();
        }

        const { suggestions } =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken: tokenRef.current,
            locationBias: {
              center: { lat: 15.853, lng: 74.502 },
              radius: 30000,
            },
          });

        return suggestions
          .filter((s) => Boolean(s.placePrediction))
          .slice(0, 6)
          .map((s, idx) => {
            const pred = s.placePrediction!;
            const main = pred.mainText?.text || pred.text?.text || 'Place';
            const secondary = pred.secondaryText?.text || '';
            const displayName = secondary ? `${main}, ${secondary}` : pred.text?.text || main;
            return {
              id: `gplace-${pred.placeId || idx}`,
              placeId: pred.placeId,
              name: main,
              displayName,
              latitude: 0,
              longitude: 0,
              source: 'GOOGLE_PLACES' as const,
              placePrediction: pred,
            };
          });
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchGmpQuotaExceeded();
        }
        return null;
      }
    },
    [isSdkReady, apiContext]
  );

  const resolvePlaceSuggestion = useCallback(
    async (
      item: ClientSuggestionItem,
      sessionSlot: 'origin' | 'destination' = 'origin'
    ): Promise<GeocodeSuggestionDTO | null> => {
      if (!item.placePrediction) return item;
      try {
        const place = item.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        });

        const tokenRef =
          sessionSlot === 'origin' ? originSessionTokenRef : destSessionTokenRef;
        tokenRef.current = null;

        const loc = place.location;
        if (!loc) return null;

        const lat = Number(loc.lat().toFixed(6));
        const lng = Number(loc.lng().toFixed(6));
        const name = place.displayName || item.name;
        const displayName = place.formattedAddress || item.displayName || name;

        return {
          id: item.id,
          placeId: place.id || item.placeId,
          name,
          displayName,
          latitude: lat,
          longitude: lng,
          source: 'GOOGLE_PLACES',
        };
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchGmpQuotaExceeded();
        }
        return null;
      }
    },
    []
  );

  const computeRoutesWithSdk = useCallback(
    async (
      origin: { lat: number; lng: number },
      destination: { lat: number; lng: number }
    ): Promise<GoogleRouteCandidatePayload[] | null> => {
      if (!isSdkReady || !apiContext) return null;
      try {
        const routesLib = (await apiContext.importLibrary(
          'routes'
        )) as google.maps.RoutesLibrary;

        const { routes } = await routesLib.Route.computeRoutes({
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          travelMode: routesLib.TravelMode.DRIVING,
          routingPreference: routesLib.RoutingPreference.TRAFFIC_AWARE,
          computeAlternativeRoutes: true,
          fields: ['path', 'distanceMeters', 'durationMillis', 'legs', 'description'],
        });

        if (!routes || routes.length === 0) return null;

        const candidates: GoogleRouteCandidatePayload[] = [];
        for (let idx = 0; idx < routes.length; idx++) {
          const rt = routes[idx];
          const pathPts = rt.path || [];
          if (pathPts.length < 2) continue;

          const geometry: Array<[number, number]> = pathPts.map((pt) => [
            Number(pt.lat.toFixed(6)),
            Number(pt.lng.toFixed(6)),
          ]);

          const steps = (rt.legs || []).flatMap((leg) =>
            (leg.steps || []).map((st) => ({
              instruction: st.instructions || 'Continue along route',
              name: st.maneuver || 'Route Step',
              distanceMeters: Math.max(0, Math.round(st.distanceMeters || 0)),
              durationSec: Math.max(0, Math.round((st.staticDurationMillis || 0) / 1000)),
              latitude: st.startLocation?.lat ?? origin.lat,
              longitude: st.startLocation?.lng ?? origin.lng,
            }))
          );

          candidates.push({
            distanceMeters: Math.max(1, Math.round(rt.distanceMeters || 0)),
            durationSeconds: Math.max(
              1,
              Math.round(((rt.durationMillis ?? rt.staticDurationMillis ?? 0) as number) / 1000)
            ),
            geometry,
            summary: rt.description || `Google Maps Route ${idx + 1}`,
            steps,
          });
        }

        return candidates.length > 0 ? candidates : null;
      } catch (err) {
        if (isQuotaError(err)) {
          dispatchGmpQuotaExceeded();
        }
        return null;
      }
    },
    [isSdkReady, apiContext]
  );

  return {
    isSdkReady,
    fetchPlaceSuggestions,
    resolvePlaceSuggestion,
    computeRoutesWithSdk,
  };
}
