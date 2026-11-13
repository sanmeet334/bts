import {
  IncidentDTO,
  RoadSegmentDTO,
  TrafficPredictionDTO,
} from '../shared/types';

export type HeatmapMetricMode = 'DENSITY' | 'DELAY';

export type HeatmapGradientPresetId =
  | 'TRAFFIC'
  | 'THERMAL'
  | 'AMBER_ALERT'
  | 'OCEAN_PULSE'
  | 'CUSTOM';

export type RgbaColor = [number, number, number, number];

export interface HeatmapConfig {
  metricMode: HeatmapMetricMode;
  densityThresholdPct: number; // 0..85
  delayThresholdMin: number; // 0..3.0
  delayScaleMaxMin: number; // 1.0..6.0
  gradientPreset: HeatmapGradientPresetId;
  customColors: [string, string, string]; // [lowHex, midHex, highHex]
  intensity: number; // 0.5..2.5
  radiusPixels: number; // 16..64
  opacity: number; // 0.3..1.0
  aggregation: 'MEAN' | 'SUM';
}

export interface HeatmapPoint {
  position: [number, number]; // [lng, lat] required by deck.gl
  weight: number;
}

export interface GradientPresetMeta {
  id: Exclude<HeatmapGradientPresetId, 'CUSTOM'>;
  label: string;
  description: string;
  barClass: string;
  colors: RgbaColor[];
}

export const HEATMAP_STORAGE_KEY = 'traffix_heatmap_config_v1';

export const DEFAULT_HEATMAP_CONFIG: HeatmapConfig = {
  metricMode: 'DENSITY',
  densityThresholdPct: 5,
  delayThresholdMin: 0.1,
  delayScaleMaxMin: 2.5,
  gradientPreset: 'TRAFFIC',
  customColors: ['#22C55E', '#EAB308', '#EF4444'],
  intensity: 1.25,
  radiusPixels: 34,
  opacity: 0.72,
  aggregation: 'MEAN',
};

export const HEATMAP_GRADIENT_PRESETS: GradientPresetMeta[] = [
  {
    id: 'TRAFFIC',
    label: 'Traffic Classic',
    description: 'Green → Yellow → Orange → Red',
    barClass: 'bg-gradient-to-r from-[#22C55E] via-[#EAB308] to-[#EF4444]',
    colors: [
      [34, 197, 94, 115],
      [132, 204, 22, 155],
      [234, 179, 8, 190],
      [249, 115, 22, 220],
      [239, 68, 68, 240],
      [185, 28, 28, 255],
    ],
  },
  {
    id: 'THERMAL',
    label: 'Thermal Surge',
    description: 'Emerald → Cyan → Amber → Crimson',
    barClass: 'bg-gradient-to-r from-[#10B981] via-[#06B6D4] to-[#E11D48]',
    colors: [
      [16, 185, 129, 115],
      [6, 182, 212, 155],
      [59, 130, 246, 185],
      [245, 158, 11, 215],
      [244, 63, 94, 240],
      [190, 18, 60, 255],
    ],
  },
  {
    id: 'AMBER_ALERT',
    label: 'Amber Alert',
    description: 'Gold → Orange → Red → Magenta',
    barClass: 'bg-gradient-to-r from-[#FDE047] via-[#F97316] to-[#9333EA]',
    colors: [
      [253, 224, 71, 115],
      [251, 191, 36, 155],
      [249, 115, 22, 190],
      [239, 68, 68, 220],
      [219, 39, 119, 240],
      [147, 51, 234, 255],
    ],
  },
  {
    id: 'OCEAN_PULSE',
    label: 'Ocean Pulse',
    description: 'Teal → Indigo → Violet → Rose',
    barClass: 'bg-gradient-to-r from-[#2DD4BF] via-[#6366F1] to-[#F43F5E]',
    colors: [
      [45, 212, 191, 115],
      [56, 189, 248, 155],
      [99, 102, 241, 190],
      [168, 85, 247, 220],
      [236, 72, 153, 240],
      [244, 63, 94, 255],
    ],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return [
      parseInt(cleaned.slice(0, 2), 16),
      parseInt(cleaned.slice(2, 4), 16),
      parseInt(cleaned.slice(4, 6), 16),
    ];
  }
  return [234, 179, 8];
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

export function resolveHeatmapColorRange(config: HeatmapConfig): RgbaColor[] {
  if (config.gradientPreset !== 'CUSTOM') {
    const preset = HEATMAP_GRADIENT_PRESETS.find((p) => p.id === config.gradientPreset);
    if (preset) return preset.colors;
  }

  const low = hexToRgb(config.customColors[0] || '#22C55E');
  const mid = hexToRgb(config.customColors[1] || '#EAB308');
  const high = hexToRgb(config.customColors[2] || '#EF4444');
  const alphas = [115, 155, 190, 220, 240, 255];

  return alphas.map((alpha, idx) => {
    const pos = idx / (alphas.length - 1); // 0..1
    if (pos <= 0.5) {
      const t = pos * 2;
      return [
        lerpChannel(low[0], mid[0], t),
        lerpChannel(low[1], mid[1], t),
        lerpChannel(low[2], mid[2], t),
        alpha,
      ];
    }
    const t = (pos - 0.5) * 2;
    return [
      lerpChannel(mid[0], high[0], t),
      lerpChannel(mid[1], high[1], t),
      lerpChannel(mid[2], high[2], t),
      alpha,
    ];
  });
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeSegmentDensity(
  seg: RoadSegmentDTO,
  pred: TrafficPredictionDTO | undefined,
  predictionMode: boolean
): number {
  if (seg.effectiveClosureStatus === 'CLOSED') {
    return 1.0;
  }

  const rawDensity =
    predictionMode && pred ? pred.predictedDensity : seg.currentCongestion;

  const incidentBoost = Math.min(0.24, (seg.activeIncidentCount || 0) * 0.12);
  const weatherPenalty =
    seg.weatherFactor > 0 && seg.weatherFactor < 1
      ? Math.min(0.15, (1 - seg.weatherFactor) * 0.45)
      : 0;

  let density = rawDensity + incidentBoost + weatherPenalty;
  if (seg.effectiveClosureStatus === 'LANE_RESTRICTED') {
    density = Math.max(0.75, density);
  }

  return clamp(density, 0.05, 1.0);
}

/**
 * Computes simulated travel-time delay (minutes above free-flow speed)
 * matching the server pathfinding slowdown model in `edgeTravelTimeMin`.
 */
export function computeSegmentDelayMin(
  seg: RoadSegmentDTO,
  pred: TrafficPredictionDTO | undefined,
  predictionMode: boolean,
  closedFallbackDelayMin = 5.0
): number {
  if (seg.effectiveClosureStatus === 'CLOSED') {
    return closedFallbackDelayMin;
  }

  const freeFlowSpeedKmh = Math.max(8, seg.speedLimitKmh || 40);
  const lengthKm = Math.max(0.05, (seg.lengthMeters || 500) / 1000);
  const freeFlowMin = (lengthKm / freeFlowSpeedKmh) * 60;

  const density = clamp(
    predictionMode && pred ? pred.predictedDensity : seg.currentCongestion,
    0,
    0.98
  );
  const congestionSlowdown = 1 - density * 0.68;
  const lanePenalty = seg.effectiveClosureStatus === 'LANE_RESTRICTED' ? 0.65 : 1.0;
  const weatherFactor = seg.weatherFactor > 0 ? seg.weatherFactor : 1.0;
  const effectiveSpeedKmh = Math.max(
    8,
    freeFlowSpeedKmh * congestionSlowdown * lanePenalty * weatherFactor
  );
  const currentTimeMin = (lengthKm / effectiveSpeedKmh) * 60;

  return Math.max(0, Number((currentTimeMin - freeFlowMin).toFixed(2)));
}

export function evaluateSegmentMetric(
  seg: RoadSegmentDTO,
  pred: TrafficPredictionDTO | undefined,
  predictionMode: boolean,
  config: HeatmapConfig
): { matches: boolean; weight: number } {
  if (config.metricMode === 'DELAY') {
    const delayMin = computeSegmentDelayMin(
      seg,
      pred,
      predictionMode,
      Math.max(config.delayScaleMaxMin, 5.0)
    );
    if (delayMin < config.delayThresholdMin) {
      return { matches: false, weight: 0 };
    }
    const weight = clamp(
      delayMin / Math.max(0.5, config.delayScaleMaxMin),
      0.06,
      1.0
    );
    return { matches: true, weight };
  }

  const density = computeSegmentDensity(seg, pred, predictionMode);
  const densityPct = density * 100;
  if (densityPct < config.densityThresholdPct) {
    return { matches: false, weight: 0 };
  }
  return { matches: true, weight: clamp(density, 0.06, 1.0) };
}

export function countMatchingSegments(
  segments: RoadSegmentDTO[],
  predictions: TrafficPredictionDTO[],
  predictionMode: boolean,
  config: HeatmapConfig
): number {
  const predBySegment = new globalThis.Map(predictions.map((p) => [p.segmentId, p]));
  let count = 0;
  for (const seg of segments) {
    if (!seg.geometry || seg.geometry.length < 2) continue;
    const { matches } = evaluateSegmentMetric(
      seg,
      predBySegment.get(seg.id),
      predictionMode,
      config
    );
    if (matches) count++;
  }
  return count;
}

export function buildHeatmapPoints(
  segments: RoadSegmentDTO[],
  incidents: IncidentDTO[],
  predictions: TrafficPredictionDTO[],
  predictionMode: boolean,
  config: HeatmapConfig = DEFAULT_HEATMAP_CONFIG
): HeatmapPoint[] {
  const points: HeatmapPoint[] = [];
  const predBySegment = new globalThis.Map(predictions.map((p) => [p.segmentId, p]));

  for (const seg of segments) {
    if (!seg.geometry || seg.geometry.length < 2) continue;
    const { matches, weight } = evaluateSegmentMetric(
      seg,
      predBySegment.get(seg.id),
      predictionMode,
      config
    );
    if (!matches) continue;

    for (let i = 0; i < seg.geometry.length - 1; i++) {
      const [lat1, lng1] = seg.geometry[i];
      const [lat2, lng2] = seg.geometry[i + 1];
      const dist = haversineMeters(lat1, lng1, lat2, lng2);
      const steps = Math.max(2, Math.min(20, Math.ceil(dist / 75)));

      for (let step = 0; step <= steps; step++) {
        if (i > 0 && step === 0) continue;
        const t = step / steps;
        const lat = lat1 + (lat2 - lat1) * t;
        const lng = lng1 + (lng2 - lng1) * t;
        points.push({
          position: [lng, lat],
          weight,
        });
      }
    }
  }

  for (const inc of incidents) {
    if (inc.status === 'REJECTED' || inc.status === 'RESOLVED') continue;
    const severityRatio =
      inc.severity === 'CRITICAL'
        ? 1.0
        : inc.severity === 'HIGH'
        ? 0.86
        : inc.severity === 'MEDIUM'
        ? 0.62
        : 0.42;

    if (config.metricMode === 'DELAY') {
      const estIncidentDelayMin = severityRatio * config.delayScaleMaxMin;
      if (estIncidentDelayMin < config.delayThresholdMin) continue;
    } else {
      if (severityRatio * 100 < config.densityThresholdPct) continue;
    }

    points.push({
      position: [inc.longitude, inc.latitude],
      weight: severityRatio,
    });
  }

  return points;
}

export function sanitizeHeatmapConfig(raw: Partial<HeatmapConfig> | null | undefined): HeatmapConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HEATMAP_CONFIG };
  const validPresetIds = new Set<HeatmapGradientPresetId>([
    'TRAFFIC',
    'THERMAL',
    'AMBER_ALERT',
    'OCEAN_PULSE',
    'CUSTOM',
  ]);
  return {
    metricMode: raw.metricMode === 'DELAY' ? 'DELAY' : 'DENSITY',
    densityThresholdPct: clamp(
      Number.isFinite(raw.densityThresholdPct)
        ? Number(raw.densityThresholdPct)
        : DEFAULT_HEATMAP_CONFIG.densityThresholdPct,
      0,
      85
    ),
    delayThresholdMin: clamp(
      Number.isFinite(raw.delayThresholdMin)
        ? Number(raw.delayThresholdMin)
        : DEFAULT_HEATMAP_CONFIG.delayThresholdMin,
      0,
      3.0
    ),
    delayScaleMaxMin: clamp(
      Number.isFinite(raw.delayScaleMaxMin)
        ? Number(raw.delayScaleMaxMin)
        : DEFAULT_HEATMAP_CONFIG.delayScaleMaxMin,
      1.0,
      6.0
    ),
    gradientPreset: validPresetIds.has(raw.gradientPreset as HeatmapGradientPresetId)
      ? (raw.gradientPreset as HeatmapGradientPresetId)
      : DEFAULT_HEATMAP_CONFIG.gradientPreset,
    customColors:
      Array.isArray(raw.customColors) &&
      raw.customColors.length === 3 &&
      raw.customColors.every((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
        ? [raw.customColors[0], raw.customColors[1], raw.customColors[2]]
        : [...DEFAULT_HEATMAP_CONFIG.customColors],
    intensity: clamp(
      Number.isFinite(raw.intensity)
        ? Number(raw.intensity)
        : DEFAULT_HEATMAP_CONFIG.intensity,
      0.5,
      2.5
    ),
    radiusPixels: clamp(
      Number.isFinite(raw.radiusPixels)
        ? Number(raw.radiusPixels)
        : DEFAULT_HEATMAP_CONFIG.radiusPixels,
      16,
      64
    ),
    opacity: clamp(
      Number.isFinite(raw.opacity)
        ? Number(raw.opacity)
        : DEFAULT_HEATMAP_CONFIG.opacity,
      0.3,
      1.0
    ),
    aggregation: raw.aggregation === 'SUM' ? 'SUM' : 'MEAN',
  };
}

export function loadHeatmapConfig(): HeatmapConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_HEATMAP_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(HEATMAP_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HEATMAP_CONFIG };
    return sanitizeHeatmapConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_HEATMAP_CONFIG };
  }
}

export function saveHeatmapConfig(config: HeatmapConfig): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(HEATMAP_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota / private mode errors
  }
}
