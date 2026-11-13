import Database from 'better-sqlite3';
import {
  EmergencyPriorityLevel,
  EmergencyTripDTO,
} from '../../shared/types.js';
import { buildEffectiveGraph } from './graph.js';
import { edgeTravelTimeMin, runDijkstra } from './pathfinding.js';

export function computeEmergencyPriorityPlan(
  db: Database.Database,
  input: {
    originNodeId: string;
    destinationNodeId: string;
    priorityLevel: EmergencyPriorityLevel;
  }
): {
  normalEtaMin: number;
  priorityEtaMin: number;
  timeSavedMin: number;
  route: EmergencyTripDTO['route'];
  junctionActions: EmergencyTripDTO['junctionActions'];
} {
  const graph = buildEffectiveGraph(db);

  // Normal commuter fastest path
  const normalResult = runDijkstra(
    graph,
    input.originNodeId,
    input.destinationNodeId,
    (e) => edgeTravelTimeMin(e)
  );

  if (!normalResult) {
    throw new Error('No passable corridor exists between origin and destination due to closures');
  }

  const prioritySpeedBoost =
    input.priorityLevel === 'CRITICAL_CODE_3'
      ? 0.62
      : input.priorityLevel === 'URGENT'
      ? 0.72
      : 0.82;

  // Priority routing prioritizes free-flow speed & avoids severe bottlenecks while respecting closed edges
  const priorityResult = runDijkstra(
    graph,
    input.originNodeId,
    input.destinationNodeId,
    (e) => {
      const baseTime = edgeTravelTimeMin(e);
      const incidentRisk = e.activeIncidentCount * 1.8;
      return baseTime * prioritySpeedBoost + incidentRisk;
    }
  );

  const chosen = priorityResult || normalResult;

  let normalEtaMin = 0;
  let normalMeters = 0;
  const normalGeometry: Array<[number, number]> = [];
  for (let i = 0; i < normalResult.edges.length; i++) {
    const e = normalResult.edges[i];
    normalEtaMin += edgeTravelTimeMin(e);
    normalMeters += e.lengthMeters;
    const pts = i === 0 ? e.geometry : e.geometry.slice(1);
    normalGeometry.push(...pts);
  }

  let priorityEtaMin = 0;
  let totalMeters = 0;
  const geometry: Array<[number, number]> = [];
  let runningOffsetMin = 0;

  const junctions = db
    .prepare('SELECT id, node_id, name FROM junctions WHERE active = 1')
    .all() as Array<{ id: string; node_id: string; name: string }>;
  const junctionByNode = new Map(junctions.map((j) => [j.node_id, j]));

  const nodeArrivalMap = new Map<string, number>();
  nodeArrivalMap.set(chosen.nodeIds[0], 0);

  for (let i = 0; i < chosen.edges.length; i++) {
    const e = chosen.edges[i];
    const segPriorityMin = edgeTravelTimeMin(e) * prioritySpeedBoost;
    priorityEtaMin += segPriorityMin;
    runningOffsetMin += segPriorityMin;
    totalMeters += e.lengthMeters;
    nodeArrivalMap.set(e.toNodeId, Number(runningOffsetMin.toFixed(1)));

    const pts = i === 0 ? e.geometry : e.geometry.slice(1);
    geometry.push(...pts);
  }

  const junctionActions: EmergencyTripDTO['junctionActions'] = [];
  for (const nid of chosen.nodeIds) {
    const j = junctionByNode.get(nid);
    if (j) {
      const offset = nodeArrivalMap.get(nid) ?? 0;
      junctionActions.push({
        junctionId: j.id,
        junctionName: j.name,
        action:
          input.priorityLevel === 'CRITICAL_CODE_3'
            ? 'PREEMPT_GREEN_WAVE'
            : offset < 2
            ? 'CLEAR_QUEUE'
            : 'HOLD_CROSS_TRAFFIC',
        estimatedArrivalOffsetMin: offset,
        simulatedControlNotice: 'SIMULATED SIGNAL PREEMPTION — NOT CONNECTED TO ROADSIDE HARDWARE',
      });
    }
  }

  const roundedNormal = Number(normalEtaMin.toFixed(1));
  const roundedPriority = Number(Math.max(0.8, priorityEtaMin).toFixed(1));
  const timeSavedMin = Number(Math.max(0.3, roundedNormal - roundedPriority).toFixed(1));

  return {
    normalEtaMin: roundedNormal,
    priorityEtaMin: roundedPriority,
    timeSavedMin,
    route: {
      pathNodeIds: chosen.nodeIds,
      pathSegmentIds: chosen.edges.map((e) => e.segmentId),
      geometry,
      totalDistanceKm: Number((totalMeters / 1000).toFixed(2)),
      dataUsed: 'Simulated Road Graph + Verified Incidents + Signal Preemption Model',
      normalRoute: {
        pathNodeIds: normalResult.nodeIds,
        pathSegmentIds: normalResult.edges.map((e) => e.segmentId),
        geometry: normalGeometry,
        totalDistanceKm: Number((normalMeters / 1000).toFixed(2)),
      },
    },
    junctionActions,
  };
}
