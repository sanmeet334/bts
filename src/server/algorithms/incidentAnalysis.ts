import Database from 'better-sqlite3';
import { IncidentSeverity, IncidentType } from '../../shared/types.js';
import { haversineMeters, pointToSegmentDistanceMeters } from './geo.js';

export function tokenizeText(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3)
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenizeText(a);
  const setB = tokenizeText(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DuplicateCheckResult {
  possibleDuplicate: boolean;
  canonicalIncidentId: string | null;
  duplicateScore: number | null;
  distanceMeters: number | null;
  duplicateReason: string | null;
}

export function detectPossibleDuplicate(
  db: Database.Database,
  input: {
    type: IncidentType;
    description: string;
    latitude: number;
    longitude: number;
    roadSegmentId?: string | null;
  },
  config = { radiusMeters: 450, timeWindowMinutes: 120 }
): DuplicateCheckResult {
  const cutoffIso = new Date(
    Date.now() - config.timeWindowMinutes * 60 * 1000
  ).toISOString();

  const recentIncidents = db
    .prepare(
      `SELECT id, type, description, latitude, longitude, road_segment_id, status, created_at
       FROM incidents
       WHERE status IN ('PENDING', 'UNDER_REVIEW', 'VERIFIED')
         AND created_at >= ?
       ORDER BY created_at DESC`
    )
    .all(cutoffIso) as Array<any>;

  let bestMatch: {
    id: string;
    score: number;
    distance: number;
    reason: string;
  } | null = null;

  for (const existing of recentIncidents) {
    const dist = haversineMeters(
      input.latitude,
      input.longitude,
      existing.latitude,
      existing.longitude
    );

    const sameSegment =
      input.roadSegmentId && existing.road_segment_id === input.roadSegmentId;

    if (dist > config.radiusMeters && !sameSegment) continue;

    const sameType = existing.type === input.type;
    const textSim = jaccardSimilarity(input.description, existing.description);
    const proximityScore = Math.max(0, 1 - dist / config.radiusMeters);
    const ageMin =
      (Date.now() - new Date(existing.created_at).getTime()) / 60000;
    const timeScore = Math.max(0, 1 - ageMin / config.timeWindowMinutes);

    const composite =
      (sameType ? 0.35 : 0.1) +
      proximityScore * 0.35 +
      textSim * 0.2 +
      timeScore * 0.1;

    if (composite >= 0.48 && (!bestMatch || composite > bestMatch.score)) {
      const reasons: string[] = [];
      reasons.push(`${Math.round(dist)}m away`);
      if (sameType) reasons.push(`same type (${input.type})`);
      if (sameSegment) reasons.push('same road segment');
      if (textSim >= 0.2)
        reasons.push(`text overlap ${Math.round(textSim * 100)}%`);
      reasons.push(`within ${Math.round(ageMin)}m`);

      bestMatch = {
        id: existing.id,
        score: Number(composite.toFixed(2)),
        distance: Math.round(dist),
        reason: reasons.join(', '),
      };
    }
  }

  if (!bestMatch) {
    return {
      possibleDuplicate: false,
      canonicalIncidentId: null,
      duplicateScore: null,
      distanceMeters: null,
      duplicateReason: null,
    };
  }

  return {
    possibleDuplicate: true,
    canonicalIncidentId: bestMatch.id,
    duplicateScore: bestMatch.score,
    distanceMeters: bestMatch.distance,
    duplicateReason: `Flagged against ${bestMatch.id}: ${bestMatch.reason}`,
  };
}

export function findNearestRoadSegmentId(
  db: Database.Database,
  lat: number,
  lng: number
): string | null {
  const segs = db
    .prepare('SELECT id, geometry_json FROM road_segments')
    .all() as Array<{ id: string; geometry_json: string }>;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const s of segs) {
    const geom = JSON.parse(s.geometry_json) as Array<[number, number]>;
    for (let i = 0; i < geom.length - 1; i++) {
      const d = pointToSegmentDistanceMeters(
        lat,
        lng,
        geom[i][0],
        geom[i][1],
        geom[i + 1][0],
        geom[i + 1][1]
      );
      if (d < bestDist) {
        bestDist = d;
        bestId = s.id;
      }
    }
  }
  return bestDist <= 1200 ? bestId : null;
}

export interface SeverityEstimationResult {
  estimatedSeverity: IncidentSeverity;
  confidence: number;
  reasons: string[];
}

export function estimateIncidentSeverity(
  db: Database.Database,
  input: {
    type: IncidentType;
    description: string;
    reportedSeverity: IncidentSeverity;
    roadSegmentId: string | null;
  }
): SeverityEstimationResult {
  let score = 0;
  const reasons: string[] = [];

  const typeWeights: Record<IncidentType, number> = {
    ACCIDENT: 0.45,
    ROADBLOCK: 0.52,
    FLOODING: 0.55,
    LANE_CLOSURE: 0.36,
    CONSTRUCTION: 0.30,
    CONGESTION: 0.28,
    BREAKDOWN: 0.22,
    OTHER: 0.20,
  };
  score += typeWeights[input.type] ?? 0.2;
  reasons.push(`Incident category ${input.type} baseline risk`);

  const lower = input.description.toLowerCase();
  const criticalKeywords = ['fatal', 'fire', 'pileup', 'ambulance', 'blocked all', 'submerged', 'collapse', 'injured'];
  const highKeywords = ['collision', 'crash', 'blocked', 'stalled bus', 'overturned', 'major', 'gridlock'];

  if (criticalKeywords.some((k) => lower.includes(k))) {
    score += 0.35;
    reasons.push('Urgent safety/full-obstruction keywords detected in description');
  } else if (highKeywords.some((k) => lower.includes(k))) {
    score += 0.2;
    reasons.push('High-impact obstruction keywords detected in description');
  }

  if (input.roadSegmentId) {
    const seg = db
      .prepare('SELECT name, capacity_vph, current_congestion FROM road_segments WHERE id = ?')
      .get(input.roadSegmentId) as { name: string; capacity_vph: number; current_congestion: number } | undefined;
    if (seg) {
      if (seg.capacity_vph >= 1800) {
        score += 0.14;
        reasons.push(`High-capacity arterial corridor (${seg.name}, ${seg.capacity_vph} vph)`);
      }
      if (seg.current_congestion >= 0.6) {
        score += 0.14;
        reasons.push(`Elevated existing corridor load (${Math.round(seg.current_congestion * 100)}%)`);
      }
    }
  }

  let estimatedSeverity: IncidentSeverity = 'LOW';
  if (score >= 0.78) estimatedSeverity = 'CRITICAL';
  else if (score >= 0.55) estimatedSeverity = 'HIGH';
  else if (score >= 0.35) estimatedSeverity = 'MEDIUM';

  const agreementBonus = estimatedSeverity === input.reportedSeverity ? 0.08 : 0;
  const confidence = Number(
    Math.min(0.95, Math.max(0.62, 0.68 + agreementBonus + (input.roadSegmentId ? 0.07 : 0))).toFixed(2)
  );

  reasons.push('Rules-based estimation; human operator review remains authoritative');

  return { estimatedSeverity, confidence, reasons };
}
