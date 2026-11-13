import {
  AnalyticsOverviewDTO,
  ApiResponse,
  AuditLogDTO,
  AuthTokensDTO,
  EmergencyPriorityLevel,
  EmergencyTripDTO,
  EmergencyTripStatus,
  EmergencyVehicleDTO,
  GeocodeSuggestionDTO,
  HistoricalAnalyticsDTO,
  HistoricalBucketHours,
  HistoricalTimeWindow,
  IncidentDTO,
  IncidentSeverity,
  IncidentStatus,
  JunctionDTO,
  NetworkImpactResultDTO,
  RoadNodeDTO,
  RoadSegmentDTO,
  RouteAlternativesResultDTO,
  SignalPlanDTO,
  SimulationScenarioDTO,
  TrafficPredictionDTO,
  UserDTO,
} from '../shared/types';
import { apiClient } from './apiClient';

export const authApi = {
  async register(payload: {
    name: string;
    email: string;
    password: string;
    role?: 'COMMUTER' | 'EMERGENCY_OPERATOR';
    vehicleType?: 'AMBULANCE' | 'FIRE_TRUCK';
    registrationLabel?: string;
  }): Promise<AuthTokensDTO> {
    const res = await apiClient.post<ApiResponse<AuthTokensDTO>>('/auth/register', payload);
    return res.data.data;
  },
  async login(payload: { email: string; password: string }): Promise<AuthTokensDTO> {
    const res = await apiClient.post<ApiResponse<AuthTokensDTO>>('/auth/login', payload);
    return res.data.data;
  },
  async me(): Promise<UserDTO> {
    const res = await apiClient.get<ApiResponse<{ user: UserDTO }>>('/auth/me');
    return res.data.data.user;
  },
  async updateProfile(name: string): Promise<UserDTO> {
    const res = await apiClient.patch<ApiResponse<{ user: UserDTO }>>('/auth/me', { name });
    return res.data.data.user;
  },
};

export const routesApi = {
  async getNetwork(): Promise<{
    nodes: RoadNodeDTO[];
    segments: RoadSegmentDTO[];
    activeClosuresCount: number;
    activeSimulationsCount: number;
    provider: any;
  }> {
    const res = await apiClient.get<ApiResponse<any>>('/routes/network');
    return res.data.data;
  },
  async geocode(q: string): Promise<{ results: GeocodeSuggestionDTO[] }> {
    const res = await apiClient.get<ApiResponse<{ results: GeocodeSuggestionDTO[] }>>(
      '/routes/geocode',
      { params: { q } }
    );
    return res.data.data;
  },
  async reverseGeocode(
    lat: number,
    lng: number
  ): Promise<{
    label: string;
    latitude: number;
    longitude: number;
    source: 'LOCAL_NODE' | 'GOOGLE_PLACES' | 'COORDINATE';
    nearestNodeId?: string;
  }> {
    const res = await apiClient.get<ApiResponse<any>>('/routes/reverse-geocode', {
      params: { lat, lng },
    });
    return res.data.data;
  },
  async getAlternatives(params: {
    originNodeId?: string;
    destinationNodeId?: string;
    originLat?: number;
    originLng?: number;
    originLabel?: string;
    destinationLat?: number;
    destinationLng?: number;
    destinationLabel?: string;
    distanceWeight?: number;
    timeWeight?: number;
    congestionWeight?: number;
    incidentWeight?: number;
  }): Promise<RouteAlternativesResultDTO> {
    const res = await apiClient.get<ApiResponse<RouteAlternativesResultDTO>>(
      '/routes/alternatives',
      { params }
    );
    return res.data.data;
  },
  async evaluateCandidates(payload: {
    originLat: number;
    originLng: number;
    originLabel?: string;
    originNodeId?: string;
    destinationLat: number;
    destinationLng: number;
    destinationLabel?: string;
    destinationNodeId?: string;
    distanceWeight?: number;
    timeWeight?: number;
    congestionWeight?: number;
    incidentWeight?: number;
    candidates: Array<{
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
    }>;
  }): Promise<RouteAlternativesResultDTO> {
    const res = await apiClient.post<ApiResponse<RouteAlternativesResultDTO>>(
      '/routes/evaluate',
      payload
    );
    return res.data.data;
  },
  async listSaved(): Promise<Array<any>> {
    const res = await apiClient.get<ApiResponse<{ routes: Array<any> }>>('/routes/saved');
    return res.data.data.routes;
  },
  async saveRoute(payload: {
    label: string;
    originNodeId?: string;
    destinationNodeId?: string;
    originLat?: number;
    originLng?: number;
    destinationLat?: number;
    destinationLng?: number;
    routeType: 'SHORTEST' | 'FASTEST' | 'RECOMMENDED';
    summary: Record<string, unknown>;
  }) {
    const res = await apiClient.post<ApiResponse<any>>('/routes/saved', payload);
    return res.data.data;
  },
  async deleteSaved(id: string) {
    const res = await apiClient.delete<ApiResponse<any>>(`/routes/saved/${id}`);
    return res.data.data;
  },
};

export const incidentsApi = {
  async list(filters?: {
    status?: string;
    type?: string;
    severity?: string;
    search?: string;
    onlyDuplicates?: boolean;
  }): Promise<IncidentDTO[]> {
    const res = await apiClient.get<ApiResponse<{ incidents: IncidentDTO[] }>>('/incidents', {
      params: filters,
    });
    return res.data.data.incidents;
  },
  async getById(id: string): Promise<{ incident: IncidentDTO; matches: Array<any> }> {
    const res = await apiClient.get<ApiResponse<{ incident: IncidentDTO; matches: Array<any> }>>(
      `/incidents/${id}`
    );
    return res.data.data;
  },
  async submit(formData: FormData): Promise<{
    incidentId: string;
    status: IncidentStatus;
    possibleDuplicate: boolean;
    incident: IncidentDTO;
  }> {
    const res = await apiClient.post<ApiResponse<any>>('/incidents', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data;
  },
  async updateStatus(
    id: string,
    payload: {
      status: Exclude<IncidentStatus, 'PENDING'>;
      severity?: IncidentSeverity;
      note?: string;
      applyRoadClosure?: boolean;
    }
  ): Promise<IncidentDTO> {
    const res = await apiClient.patch<ApiResponse<{ incident: IncidentDTO }>>(
      `/incidents/${id}/status`,
      payload
    );
    return res.data.data.incident;
  },
  async runImpactAnalysis(id: string): Promise<NetworkImpactResultDTO> {
    const res = await apiClient.post<ApiResponse<NetworkImpactResultDTO>>(
      `/incidents/${id}/impact-analysis`
    );
    return res.data.data;
  },
};

export const simulationsApi = {
  async list(): Promise<SimulationScenarioDTO[]> {
    const res = await apiClient.get<ApiResponse<{ scenarios: SimulationScenarioDTO[] }>>(
      '/simulations'
    );
    return res.data.data.scenarios;
  },
  async createClosure(payload: {
    name: string;
    type: 'FULL_CLOSURE' | 'LANE_BLOCKAGE' | 'CAPACITY_REDUCTION' | 'TRAFFIC_SURGE';
    targetSegmentId: string;
    originNodeId?: string;
    destinationNodeId?: string;
  }): Promise<SimulationScenarioDTO> {
    const res = await apiClient.post<ApiResponse<{ scenario: SimulationScenarioDTO }>>(
      '/simulations/closures',
      payload
    );
    return res.data.data.scenario;
  },
  async end(id: string): Promise<SimulationScenarioDTO> {
    const res = await apiClient.post<ApiResponse<{ scenario: SimulationScenarioDTO }>>(
      `/simulations/${id}/end`
    );
    return res.data.data.scenario;
  },
  async applyTrafficControls(payload: {
    densityMultiplier: number;
    weatherCondition: 'CLEAR' | 'RAIN' | 'HEAVY_RAIN';
  }) {
    const res = await apiClient.post<ApiResponse<any>>(
      '/simulations/traffic-controls',
      payload
    );
    return res.data.data;
  },
};

export const predictionsApi = {
  async getLatest(filters?: { horizon?: 15 | 30; segmentId?: string }): Promise<{
    predictions: TrafficPredictionDTO[];
    modelInfo: {
      modelVersion: string;
      maeEstimate: number;
      rmseEstimate: number;
      dataSource: string;
      isSimulated: boolean;
      lastPredictedAt: string | null;
    };
  }> {
    const res = await apiClient.get<ApiResponse<any>>('/predictions', { params: filters });
    return res.data.data;
  },
  async runPipeline(payload?: {
    weatherCondition?: 'CLEAR' | 'RAIN' | 'HEAVY_RAIN';
    densityMultiplier?: number;
  }) {
    const res = await apiClient.post<ApiResponse<any>>('/predictions/run', payload || {});
    return res.data.data;
  },
};

export const signalsApi = {
  async listJunctions(): Promise<JunctionDTO[]> {
    const res = await apiClient.get<ApiResponse<{ junctions: JunctionDTO[] }>>(
      '/signals/junctions'
    );
    return res.data.data.junctions;
  },
  async optimize(payload: {
    junctionId: string;
    observedDensity: number;
    observedQueue: number;
  }): Promise<SignalPlanDTO> {
    const res = await apiClient.post<ApiResponse<{ plan: SignalPlanDTO }>>(
      '/signals/optimize',
      payload
    );
    return res.data.data.plan;
  },
  async approve(planId: string): Promise<SignalPlanDTO> {
    const res = await apiClient.post<ApiResponse<{ plan: SignalPlanDTO }>>(
      `/signals/plans/${planId}/approve`
    );
    return res.data.data.plan;
  },
  async history(): Promise<SignalPlanDTO[]> {
    const res = await apiClient.get<ApiResponse<{ plans: SignalPlanDTO[] }>>(
      '/signals/history'
    );
    return res.data.data.plans;
  },
};

export const emergencyApi = {
  async listVehicles(): Promise<EmergencyVehicleDTO[]> {
    const res = await apiClient.get<ApiResponse<{ vehicles: EmergencyVehicleDTO[] }>>(
      '/emergency/vehicles'
    );
    return res.data.data.vehicles;
  },
  async listTrips(): Promise<EmergencyTripDTO[]> {
    const res = await apiClient.get<ApiResponse<{ trips: EmergencyTripDTO[] }>>(
      '/emergency/trips'
    );
    return res.data.data.trips;
  },
  async createTrip(payload: {
    vehicleId: string;
    originNodeId: string;
    destinationNodeId: string;
    priorityLevel: EmergencyPriorityLevel;
  }): Promise<EmergencyTripDTO> {
    const res = await apiClient.post<ApiResponse<{ trip: EmergencyTripDTO }>>(
      '/emergency/trips',
      payload
    );
    return res.data.data.trip;
  },
  async updateStatus(
    id: string,
    status: Exclude<EmergencyTripStatus, 'REQUESTED'>,
    failureReason?: string
  ): Promise<EmergencyTripDTO> {
    const res = await apiClient.patch<ApiResponse<{ trip: EmergencyTripDTO }>>(
      `/emergency/trips/${id}/status`,
      { status, failureReason }
    );
    return res.data.data.trip;
  },
  async recalculatePriorityRoute(id: string): Promise<EmergencyTripDTO> {
    const res = await apiClient.post<ApiResponse<{ trip: EmergencyTripDTO }>>(
      `/emergency/trips/${id}/priority-route`
    );
    return res.data.data.trip;
  },
  async updateLocation(id: string, latitude: number, longitude: number): Promise<EmergencyTripDTO> {
    const res = await apiClient.patch<ApiResponse<{ trip: EmergencyTripDTO }>>(
      `/emergency/trips/${id}/location`,
      { latitude, longitude }
    );
    return res.data.data.trip;
  },
};

export const analyticsApi = {
  async getPublicSummary(): Promise<{
    networkSummary: AnalyticsOverviewDTO['networkSummary'];
    verifiedIncidentsCount: number;
    predictionStats: AnalyticsOverviewDTO['predictionStats'];
  }> {
    const res = await apiClient.get<ApiResponse<any>>('/analytics/public-summary');
    return res.data.data;
  },
  async getOverview(): Promise<AnalyticsOverviewDTO> {
    const res = await apiClient.get<ApiResponse<AnalyticsOverviewDTO>>('/analytics/overview');
    return res.data.data;
  },
  async getHistorical(params?: {
    window?: HistoricalTimeWindow;
    bucketHours?: HistoricalBucketHours;
    segmentId?: string;
  }): Promise<HistoricalAnalyticsDTO> {
    const res = await apiClient.get<ApiResponse<HistoricalAnalyticsDTO>>(
      '/analytics/historical',
      { params }
    );
    return res.data.data;
  },
  async getAuditLogs(limit = 60): Promise<AuditLogDTO[]> {
    const res = await apiClient.get<ApiResponse<{ logs: AuditLogDTO[] }>>(
      '/analytics/audit-logs',
      { params: { limit } }
    );
    return res.data.data.logs;
  },
  async downloadCsv(): Promise<Blob> {
    const res = await apiClient.get('/analytics/export/csv', { responseType: 'blob' });
    return res.data;
  },
};
