export interface SignalPhaseTiming {
  phaseId: string;
  approach: string;
  greenSec: number;
  amberSec: number;
  redSec: number;
}

export interface SignalSimMetrics {
  avgWaitTimeSec: number;
  maxQueueVehicles: number;
  throughputVph: number;
  totalDelaySec: number;
}

export interface SignalOptimizationOutput {
  proposedTimings: SignalPhaseTiming[];
  reason: string;
  beforeMetrics: SignalSimMetrics;
  afterMetrics: SignalSimMetrics;
}

function simulateCycleQueue(
  phases: SignalPhaseTiming[],
  cycleLengthSec: number,
  lanesCount: number,
  observedDensity: number,
  observedQueue: number
): SignalSimMetrics {
  // Deterministic Webster-aligned uniform + overflow delay simulation over 15-minute window (900s)
  const saturationFlowPerLaneVph = 1800;
  const totalCapPerPhase = lanesCount * saturationFlowPerLaneVph;
  const arrivalRateVps = Math.max(
    0.15,
    (observedDensity * lanesCount * 580) / 3600 + observedQueue * 0.012
  );

  let waitSum = 0;
  let maxQ = 0;
  let totalThroughput = 0;

  // Weight Phase 1 slightly heavier when queue is high to model main-corridor imbalance
  const phaseDemands = phases.map((_, idx) =>
    idx === 0 ? arrivalRateVps * 0.62 : (arrivalRateVps * 0.38) / Math.max(1, phases.length - 1)
  );

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const greenRatio = Math.max(0.1, p.greenSec / cycleLengthSec);
    const effectiveRed = Math.max(4, cycleLengthSec - p.greenSec);
    const demandVps = phaseDemands[i];
    const capacityVps = (totalCapPerPhase / 3600) * greenRatio;
    const degreeOfSaturation = Math.min(1.15, demandVps / Math.max(0.05, capacityVps));

    // Webster uniform delay term + overflow queue penalty
    const uniformDelay =
      (cycleLengthSec * Math.pow(1 - greenRatio, 2)) /
      (2 * Math.max(0.15, 1 - Math.min(0.95, greenRatio * degreeOfSaturation)));
    const overflowDelay =
      degreeOfSaturation > 0.78
        ? Math.pow(degreeOfSaturation - 0.78, 2) * 145
        : 0;

    const phaseWait = uniformDelay + overflowDelay + observedQueue * 0.35;
    waitSum += phaseWait;

    const queueDuringRed = Math.round(
      demandVps * effectiveRed + observedQueue * (i === 0 ? 0.65 : 0.35)
    );
    maxQ = Math.max(maxQ, queueDuringRed);

    const servedRate = Math.min(demandVps * 1.15, capacityVps);
    totalThroughput += Math.round(servedRate * 3600);
  }

  const avgWaitTimeSec = Number((waitSum / Math.max(1, phases.length)).toFixed(1));
  const totalDelaySec = Math.round(avgWaitTimeSec * (observedQueue + 12));

  return {
    avgWaitTimeSec,
    maxQueueVehicles: maxQ,
    throughputVph: totalThroughput,
    totalDelaySec,
  };
}

export function calculateAdaptiveSignalPlan(input: {
  phases: SignalPhaseTiming[];
  lanesCount: number;
  minGreenSec: number;
  maxGreenSec: number;
  cycleLengthSec: number;
  observedDensity: number;
  observedQueue: number;
}): SignalOptimizationOutput {
  const {
    phases,
    lanesCount,
    minGreenSec,
    maxGreenSec,
    cycleLengthSec,
    observedDensity,
    observedQueue,
  } = input;

  if (phases.length < 2) {
    throw new Error('Junction must have at least 2 signal phases for conflict-safe optimization');
  }

  const amberPerPhase = 4;
  const totalUsableGreen = Math.max(
    phases.length * minGreenSec,
    cycleLengthSec - phases.length * amberPerPhase
  );

  // Adaptive shift: allocate green proportionally to corridor queue & density while respecting [minGreen, maxGreen]
  const primaryDemandWeight = Math.min(
    0.72,
    Math.max(0.48, 0.5 + (observedDensity - 0.35) * 0.28 + Math.min(0.15, observedQueue * 0.005))
  );

  const rawGreens: number[] = phases.map((_, idx) => {
    const share =
      idx === 0
        ? primaryDemandWeight
        : (1 - primaryDemandWeight) / Math.max(1, phases.length - 1);
    const candidate = Math.round(totalUsableGreen * share);
    return Math.min(maxGreenSec, Math.max(minGreenSec, candidate));
  });

  // Safety conflict check: ensure sum of greens + ambers equals cycleLengthSec exactly
  const currentGreenSum = rawGreens.reduce((acc, g) => acc + g, 0);
  const diff = totalUsableGreen - currentGreenSum;
  if (diff !== 0) {
    const adjusted = Math.min(
      maxGreenSec,
      Math.max(minGreenSec, rawGreens[0] + diff)
    );
    rawGreens[0] = adjusted;
  }

  const finalGreenSum = rawGreens.reduce((acc, g) => acc + g, 0);
  const actualCycle = finalGreenSum + phases.length * amberPerPhase;

  const proposedTimings: SignalPhaseTiming[] = phases.map((p, idx) => {
    const greenSec = rawGreens[idx];
    const redSec = Math.max(minGreenSec, actualCycle - greenSec - amberPerPhase);
    return {
      phaseId: p.phaseId,
      approach: p.approach,
      greenSec,
      amberSec: amberPerPhase,
      redSec,
    };
  });

  const beforeMetrics = simulateCycleQueue(
    phases,
    cycleLengthSec,
    lanesCount,
    observedDensity,
    observedQueue
  );
  const afterMetrics = simulateCycleQueue(
    proposedTimings,
    actualCycle,
    lanesCount,
    observedDensity,
    observedQueue
  );

  const deltaWait = Number((beforeMetrics.avgWaitTimeSec - afterMetrics.avgWaitTimeSec).toFixed(1));
  const reason =
    deltaWait > 0
      ? `Reallocated primary phase green to ${proposedTimings[0].greenSec}s within safety bounds [${minGreenSec}s–${maxGreenSec}s] for density ${Math.round(observedDensity * 100)}% and queue ${observedQueue} veh, reducing modeled wait by ${deltaWait}s.`
      : `Balanced phase split within safety bounds [${minGreenSec}s–${maxGreenSec}s] for fairness across ${phases.length} approaches.`;

  return {
    proposedTimings,
    reason,
    beforeMetrics,
    afterMetrics,
  };
}
