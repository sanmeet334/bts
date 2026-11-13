export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('COMMUTER', 'ADMIN', 'SIGNAL_OPERATOR', 'EMERGENCY_OPERATOR')),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS road_nodes (
  id TEXT PRIMARY KEY,
  external_ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  is_junction INTEGER NOT NULL DEFAULT 0,
  zone TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_road_nodes_coords ON road_nodes(latitude, longitude);

CREATE TABLE IF NOT EXISTS road_segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_node_id TEXT NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
  end_node_id TEXT NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
  geometry_json TEXT NOT NULL,
  length_meters REAL NOT NULL,
  capacity_vph INTEGER NOT NULL,
  speed_limit_kmh REAL NOT NULL,
  current_congestion REAL NOT NULL DEFAULT 0.25,
  closure_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (closure_status IN ('OPEN', 'LANE_RESTRICTED', 'CLOSED')),
  weather_factor REAL NOT NULL DEFAULT 1.0,
  one_way INTEGER NOT NULL DEFAULT 0,
  is_simulated INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_road_segments_nodes ON road_segments(start_node_id, end_node_id);
CREATE INDEX IF NOT EXISTS idx_road_segments_status ON road_segments(closure_status);

CREATE TABLE IF NOT EXISTS traffic_observations (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  vehicle_count INTEGER NOT NULL,
  average_speed_kmh REAL NOT NULL,
  queue_length INTEGER NOT NULL DEFAULT 0,
  weather_condition TEXT NOT NULL DEFAULT 'CLEAR',
  source TEXT NOT NULL DEFAULT 'SIMULATED_BASELINE',
  is_simulated INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_observations_segment_time ON traffic_observations(segment_id, observed_at);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('ACCIDENT', 'ROADBLOCK', 'CONGESTION', 'CONSTRUCTION', 'LANE_CLOSURE', 'BREAKDOWN', 'FLOODING', 'OTHER')),
  description TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  road_segment_id TEXT REFERENCES road_segments(id) ON DELETE SET NULL,
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  estimated_severity TEXT NOT NULL CHECK (estimated_severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  severity_confidence REAL NOT NULL DEFAULT 0.75,
  severity_reasons_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'RESOLVED')),
  image_url TEXT,
  possible_duplicate INTEGER NOT NULL DEFAULT 0,
  canonical_incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
  duplicate_score REAL,
  duplicate_reason TEXT,
  verified_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_segment ON incidents(road_segment_id);
CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(created_at);

CREATE TABLE IF NOT EXISTS incident_matches (
  id TEXT PRIMARY KEY,
  submitted_incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  canonical_incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  similarity_score REAL NOT NULL,
  distance_meters REAL NOT NULL,
  reason TEXT NOT NULL,
  review_outcome TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic_predictions (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
  predicted_at TEXT NOT NULL,
  horizon_minutes INTEGER NOT NULL CHECK (horizon_minutes IN (15, 30)),
  current_density REAL NOT NULL,
  current_speed_kmh REAL NOT NULL,
  predicted_density REAL NOT NULL,
  predicted_speed_kmh REAL NOT NULL,
  congestion_class TEXT NOT NULL CHECK (congestion_class IN ('CLEAR', 'MODERATE', 'HIGH', 'SEVERE')),
  risk_score REAL NOT NULL,
  model_version TEXT NOT NULL,
  mae_estimate REAL NOT NULL,
  rmse_estimate REAL NOT NULL,
  data_source TEXT NOT NULL,
  is_simulated INTEGER NOT NULL DEFAULT 1,
  input_summary_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_predictions_segment_horizon ON traffic_predictions(segment_id, horizon_minutes, predicted_at);

CREATE TABLE IF NOT EXISTS junctions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES road_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  approaches_json TEXT NOT NULL,
  lanes_count INTEGER NOT NULL,
  min_green_sec INTEGER NOT NULL,
  max_green_sec INTEGER NOT NULL,
  cycle_length_sec INTEGER NOT NULL,
  current_phases_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS signal_plans (
  id TEXT PRIMARY KEY,
  junction_id TEXT NOT NULL REFERENCES junctions(id) ON DELETE CASCADE,
  initiated_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  observed_density REAL NOT NULL,
  observed_queue INTEGER NOT NULL,
  current_timings_json TEXT NOT NULL,
  proposed_timings_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_metrics_json TEXT NOT NULL,
  after_metrics_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (status IN ('SIMULATED', 'APPROVED_SIMULATION')),
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS emergency_vehicles (
  id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('AMBULANCE', 'FIRE_TRUCK')),
  registration_label TEXT NOT NULL UNIQUE,
  available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emergency_trips (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES emergency_vehicles(id) ON DELETE CASCADE,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_node_id TEXT NOT NULL REFERENCES road_nodes(id),
  destination_node_id TEXT NOT NULL REFERENCES road_nodes(id),
  priority_level TEXT NOT NULL CHECK (priority_level IN ('STANDARD', 'URGENT', 'CRITICAL_CODE_3')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'ACTIVE', 'EN_ROUTE', 'COMPLETED', 'CANCELLED', 'BLOCKED')),
  normal_eta_min REAL NOT NULL,
  priority_eta_min REAL NOT NULL,
  time_saved_min REAL NOT NULL,
  route_json TEXT NOT NULL,
  junction_actions_json TEXT NOT NULL,
  current_lat REAL,
  current_lng REAL,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('FULL_CLOSURE', 'LANE_BLOCKAGE', 'CAPACITY_REDUCTION', 'TRAFFIC_SURGE')),
  target_segment_id TEXT NOT NULL REFERENCES road_segments(id) ON DELETE CASCADE,
  parameters_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS saved_routes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  origin_node_id TEXT NOT NULL REFERENCES road_nodes(id),
  destination_node_id TEXT NOT NULL REFERENCES road_nodes(id),
  route_type TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_summary TEXT NOT NULL,
  after_summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
`;
