import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Valid email address is required').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72)
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[0-9]/, 'Password must include at least one number'),
  role: z
    .enum(['COMMUTER', 'EMERGENCY_OPERATOR'])
    .optional()
    .default('COMMUTER'),
  vehicleType: z.enum(['AMBULANCE', 'FIRE_TRUCK']).optional(),
  registrationLabel: z.string().trim().min(3).max(40).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token is required'),
});

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export const routeAlternativesQuerySchema = z
  .object({
    originNodeId: z.string().trim().min(1).optional(),
    destinationNodeId: z.string().trim().min(1).optional(),
    originLat: z.coerce.number().min(-90).max(90).optional(),
    originLng: z.coerce.number().min(-180).max(180).optional(),
    originLabel: z.string().trim().max(160).optional(),
    destinationLat: z.coerce.number().min(-90).max(90).optional(),
    destinationLng: z.coerce.number().min(-180).max(180).optional(),
    destinationLabel: z.string().trim().max(160).optional(),
    distanceWeight: z.coerce.number().min(0).max(1).optional(),
    timeWeight: z.coerce.number().min(0).max(1).optional(),
    congestionWeight: z.coerce.number().min(0).max(1).optional(),
    incidentWeight: z.coerce.number().min(0).max(1).optional(),
  })
  .refine(
    (data) =>
      (Boolean(data.originNodeId) && Boolean(data.destinationNodeId)) ||
      (data.originLat !== undefined &&
        data.originLng !== undefined &&
        data.destinationLat !== undefined &&
        data.destinationLng !== undefined),
    {
      message:
        'Provide either originNodeId & destinationNodeId OR originLat, originLng, destinationLat & destinationLng',
    }
  );

export const evaluateRoutesBodySchema = z.object({
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  originLabel: z.string().trim().max(160).optional(),
  originNodeId: z.string().trim().min(1).optional(),
  destinationLat: z.number().min(-90).max(90),
  destinationLng: z.number().min(-180).max(180),
  destinationLabel: z.string().trim().max(160).optional(),
  destinationNodeId: z.string().trim().min(1).optional(),
  distanceWeight: z.number().min(0).max(1).optional(),
  timeWeight: z.number().min(0).max(1).optional(),
  congestionWeight: z.number().min(0).max(1).optional(),
  incidentWeight: z.number().min(0).max(1).optional(),
  candidates: z
    .array(
      z.object({
        distanceMeters: z.number().nonnegative(),
        durationSeconds: z.number().nonnegative(),
        geometry: z.array(z.tuple([z.number(), z.number()])).min(2),
        summary: z.string().max(200).optional(),
        steps: z
          .array(
            z.object({
              instruction: z.string(),
              name: z.string().optional(),
              distanceMeters: z.number().nonnegative().optional(),
              durationSec: z.number().nonnegative().optional(),
              latitude: z.number(),
              longitude: z.number(),
            })
          )
          .optional()
          .default([]),
      })
    )
    .min(1)
    .max(5),
});

export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const saveRouteSchema = z.object({
  label: z.string().trim().min(2).max(120),
  originNodeId: z.string().trim().min(1).optional(),
  destinationNodeId: z.string().trim().min(1).optional(),
  originLat: z.coerce.number().min(-90).max(90).optional(),
  originLng: z.coerce.number().min(-180).max(180).optional(),
  destinationLat: z.coerce.number().min(-90).max(90).optional(),
  destinationLng: z.coerce.number().min(-180).max(180).optional(),
  routeType: z.enum(['SHORTEST', 'FASTEST', 'RECOMMENDED']),
  summary: z.record(z.string(), z.unknown()),
});

export const createIncidentSchema = z.object({
  type: z.enum([
    'ACCIDENT',
    'ROADBLOCK',
    'CONGESTION',
    'CONSTRUCTION',
    'LANE_CLOSURE',
    'BREAKDOWN',
    'FLOODING',
    'OTHER',
  ]),
  description: z
    .string()
    .trim()
    .min(8, 'Please provide at least 8 characters describing the incident')
    .max(500),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  roadSegmentId: z.string().trim().optional().nullable(),
});

export const updateIncidentStatusSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'RESOLVED']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  note: z.string().trim().max(300).optional(),
  applyRoadClosure: z.boolean().optional(),
});

export const closureSimulationSchema = z.object({
  name: z.string().trim().min(3).max(100),
  type: z.enum(['FULL_CLOSURE', 'LANE_BLOCKAGE', 'CAPACITY_REDUCTION', 'TRAFFIC_SURGE']),
  targetSegmentId: z.string().trim().min(1),
  originNodeId: z.string().trim().optional(),
  destinationNodeId: z.string().trim().optional(),
  densityMultiplier: z.coerce.number().min(0.5).max(2.5).optional(),
  weatherCondition: z.enum(['CLEAR', 'RAIN', 'HEAVY_RAIN']).optional(),
});

export const trafficControlSimSchema = z.object({
  densityMultiplier: z.coerce.number().min(0.4).max(2.0).default(1.0),
  weatherCondition: z.enum(['CLEAR', 'RAIN', 'HEAVY_RAIN']).default('CLEAR'),
});

export const predictionRunSchema = z.object({
  weatherCondition: z.enum(['CLEAR', 'RAIN', 'HEAVY_RAIN']).optional().default('CLEAR'),
  densityMultiplier: z.coerce.number().min(0.5).max(2.0).optional().default(1.0),
});

export const signalOptimizeSchema = z.object({
  junctionId: z.string().trim().min(1),
  observedDensity: z.coerce.number().min(0.05).max(1.0),
  observedQueue: z.coerce.number().int().min(0).max(120),
});

export const createEmergencyTripSchema = z.object({
  vehicleId: z.string().trim().min(1),
  originNodeId: z.string().trim().min(1),
  destinationNodeId: z.string().trim().min(1),
  priorityLevel: z.enum(['STANDARD', 'URGENT', 'CRITICAL_CODE_3']),
});

export const updateEmergencyStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'EN_ROUTE', 'COMPLETED', 'CANCELLED', 'BLOCKED']),
  failureReason: z.string().trim().max(250).optional(),
});

export const emergencyLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

export const idParamSchema = z.object({
  id: z.string().trim().min(1).max(100),
});
