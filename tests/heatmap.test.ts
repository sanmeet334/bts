import { describe, expect, it } from 'vitest';
import { IncidentDTO, RoadSegmentDTO } from '../src/shared/types.js';
import {
  buildHeatmapPoints,
  computeSegmentDelayMin,
  countMatchingSegments,
  DEFAULT_HEATMAP_CONFIG,
  HeatmapConfig,
  resolveHeatmapColorRange,
  sanitizeHeatmapConfig,
} from '../src/utils/heatmapUtils.js';

const mockSegments: RoadSegmentDTO[] = [
  {
    id: 'seg-low',
    name: 'Low Congestion Ring',
    startNodeId: 'n1',
    endNodeId: 'n2',
    geometry: [
      [15.85, 74.49],
      [15.855, 74.495],
    ],
    lengthMeters: 1000,
    capacityVph: 2400,
    speedLimitKmh: 60,
    currentCongestion: 0.2,
    closureStatus: 'OPEN',
    effectiveClosureStatus: 'OPEN',
    weatherFactor: 1.0,
    activeIncidentCount: 0,
    simulatedBlocked: false,
    congestionClass: 'CLEAR',
    isSimulated: true,
  },
  {
    id: 'seg-heavy',
    name: 'Heavy Market Street',
    startNodeId: 'n2',
    endNodeId: 'n3',
    geometry: [
      [15.855, 74.495],
      [15.86, 74.502],
    ],
    lengthMeters: 1200,
    capacityVph: 1400,
    speedLimitKmh: 36,
    currentCongestion: 0.72,
    closureStatus: 'OPEN',
    effectiveClosureStatus: 'OPEN',
    weatherFactor: 1.0,
    activeIncidentCount: 0,
    simulatedBlocked: false,
    congestionClass: 'HIGH',
    isSimulated: true,
  },
];

const mockIncidents: IncidentDTO[] = [
  {
    id: 'inc-1',
    reporterId: 'u1',
    type: 'ACCIDENT',
    description: 'Two-lane collision near junction',
    latitude: 15.858,
    longitude: 74.5,
    roadSegmentId: 'seg-heavy',
    severity: 'HIGH',
    estimatedSeverity: 'HIGH',
    severityConfidence: 0.9,
    severityReasons: [],
    status: 'VERIFIED',
    imageUrl: null,
    possibleDuplicate: false,
    canonicalIncidentId: null,
    duplicateScore: null,
    duplicateReason: null,
    verifiedBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: null,
  },
];

describe('Heatmap Configuration & Metric Utilities', () => {
  it('filters segments and incidents by congestion density threshold', () => {
    const allConfig: HeatmapConfig = {
      ...DEFAULT_HEATMAP_CONFIG,
      metricMode: 'DENSITY',
      densityThresholdPct: 0,
    };
    expect(countMatchingSegments(mockSegments, [], false, allConfig)).toBe(2);

    const heavyOnlyConfig: HeatmapConfig = {
      ...DEFAULT_HEATMAP_CONFIG,
      metricMode: 'DENSITY',
      densityThresholdPct: 60,
    };
    expect(countMatchingSegments(mockSegments, [], false, heavyOnlyConfig)).toBe(1);

    const pts = buildHeatmapPoints(mockSegments, mockIncidents, [], false, heavyOnlyConfig);
    expect(pts.length).toBeGreaterThan(1);
    expect(pts.every((p) => p.weight >= 0.6)).toBe(true);
  });

  it('computes simulated travel-time delay and filters by delay threshold', () => {
    const lowDelay = computeSegmentDelayMin(mockSegments[0], undefined, false);
    const heavyDelay = computeSegmentDelayMin(mockSegments[1], undefined, false);
    expect(lowDelay).toBeLessThan(0.3);
    expect(heavyDelay).toBeGreaterThan(1.5);

    const delayConfig: HeatmapConfig = {
      ...DEFAULT_HEATMAP_CONFIG,
      metricMode: 'DELAY',
      delayThresholdMin: 1.0,
      delayScaleMaxMin: 2.5,
    };
    expect(countMatchingSegments(mockSegments, [], false, delayConfig)).toBe(1);
    const pts = buildHeatmapPoints(mockSegments, [], [], false, delayConfig);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => p.weight >= 0.6)).toBe(true);
  });

  it('resolves preset and custom 3-stop RGBA gradient color ranges', () => {
    const customConfig: HeatmapConfig = {
      ...DEFAULT_HEATMAP_CONFIG,
      gradientPreset: 'CUSTOM',
      customColors: ['#00FF00', '#0000FF', '#FF0000'],
    };
    const range = resolveHeatmapColorRange(customConfig);
    expect(range).toHaveLength(6);
    expect(range[0]).toEqual([0, 255, 0, 115]);
    expect(range[5]).toEqual([255, 0, 0, 255]);
  });

  it('sanitizes out-of-range heatmap config values safely', () => {
    const sanitized = sanitizeHeatmapConfig({
      metricMode: 'DELAY',
      densityThresholdPct: 500,
      delayThresholdMin: -2,
      intensity: 10,
      radiusPixels: 4,
      opacity: 2,
      customColors: ['#112233', 'invalid' as any, '#445566'],
    });
    expect(sanitized.densityThresholdPct).toBe(85);
    expect(sanitized.delayThresholdMin).toBe(0);
    expect(sanitized.intensity).toBe(2.5);
    expect(sanitized.radiusPixels).toBe(16);
    expect(sanitized.opacity).toBe(1.0);
    expect(sanitized.customColors).toEqual(DEFAULT_HEATMAP_CONFIG.customColors);
  });
});
