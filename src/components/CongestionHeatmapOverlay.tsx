import React, { useEffect, useMemo, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { LayersList } from '@deck.gl/core';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import {
  IncidentDTO,
  RoadSegmentDTO,
  TrafficPredictionDTO,
} from '../shared/types';
import {
  buildHeatmapPoints,
  DEFAULT_HEATMAP_CONFIG,
  HeatmapConfig,
  HeatmapPoint,
  resolveHeatmapColorRange,
} from '../utils/heatmapUtils';

interface CongestionHeatmapOverlayProps {
  mapId: string;
  segments: RoadSegmentDTO[];
  incidents?: IncidentDTO[];
  predictions?: TrafficPredictionDTO[];
  predictionMode?: boolean;
  visible: boolean;
  config?: HeatmapConfig;
  onAvailabilityChange?: (available: boolean, reason?: string) => void;
}

function isWebGL2Supported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

export const CongestionHeatmapOverlay: React.FC<CongestionHeatmapOverlayProps> = ({
  mapId,
  segments,
  incidents = [],
  predictions = [],
  predictionMode = false,
  visible,
  config = DEFAULT_HEATMAP_CONFIG,
  onAvailabilityChange,
}) => {
  const map = useMap(mapId);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const onAvailabilityChangeRef = useRef(onAvailabilityChange);
  onAvailabilityChangeRef.current = onAvailabilityChange;

  const webgl2Supported = useMemo(() => isWebGL2Supported(), []);

  useEffect(() => {
    if (!webgl2Supported) {
      onAvailabilityChangeRef.current?.(
        false,
        'WebGL2 is unavailable in this browser environment'
      );
      return;
    }
    onAvailabilityChangeRef.current?.(true);
  }, [webgl2Supported]);

  const heatmapData = useMemo(() => {
    if (!visible) return [];
    return buildHeatmapPoints(segments, incidents, predictions, predictionMode, config);
  }, [visible, segments, incidents, predictions, predictionMode, config]);

  const colorRange = useMemo(() => resolveHeatmapColorRange(config), [config]);

  const layers: LayersList = useMemo(() => {
    if (!visible || !webgl2Supported || heatmapData.length === 0) {
      return [];
    }

    return [
      new HeatmapLayer<HeatmapPoint>({
        id: 'traffix-congestion-heatmap',
        data: heatmapData,
        getPosition: (d) => d.position,
        getWeight: (d) => d.weight,
        radiusPixels: config.radiusPixels,
        intensity: config.intensity,
        threshold: 0.04,
        aggregation: config.aggregation,
        colorRange,
        opacity: config.opacity,
        updateTriggers: {
          getWeight: [
            config.metricMode,
            config.densityThresholdPct,
            config.delayThresholdMin,
            config.delayScaleMaxMin,
          ],
        },
      }),
    ];
  }, [
    visible,
    webgl2Supported,
    heatmapData,
    config.radiusPixels,
    config.intensity,
    config.aggregation,
    config.opacity,
    config.metricMode,
    config.densityThresholdPct,
    config.delayThresholdMin,
    config.delayScaleMaxMin,
    colorRange,
  ]);

  // Attach GoogleMapsOverlay to the Google Map instance with graceful WebGL error handling
  useEffect(() => {
    if (!map || !webgl2Supported) return;

    let overlay: GoogleMapsOverlay | null = null;
    try {
      overlay = new GoogleMapsOverlay({
        interleaved: true,
        onError: (err) => {
          onAvailabilityChangeRef.current?.(
            false,
            err?.message || 'Heatmap WebGL renderer error'
          );
        },
      });
      overlay.setMap(map);
      overlayRef.current = overlay;
    } catch (err: any) {
      onAvailabilityChangeRef.current?.(
        false,
        err?.message || 'Unable to initialize congestion heatmap overlay'
      );
      overlayRef.current = null;
    }

    return () => {
      if (overlay) {
        try {
          overlay.setProps({ layers: [] });
          overlay.setMap(null);
          overlay.finalize();
        } catch {
          // Ignore teardown errors if map/WebGL context already disposed
        }
      }
      overlayRef.current = null;
    };
  }, [map, webgl2Supported]);

  // Sync HeatmapLayer props whenever simulation data or user settings change
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !webgl2Supported) return;
    try {
      overlay.setProps({ layers });
    } catch (err: any) {
      onAvailabilityChangeRef.current?.(
        false,
        err?.message || 'Failed to update congestion heatmap layer'
      );
    }
  }, [layers, webgl2Supported]);

  return null;
};
