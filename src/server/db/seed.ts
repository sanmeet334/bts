import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

export function seedDatabase(db: Database.Database): void {
  const now = new Date().toISOString();

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
  `);

  const demoUsers = [
    {
      id: 'usr-commuter-1',
      name: 'Aarav Kulkarni (Demo Commuter)',
      email: 'commuter@traffix.demo',
      pass: 'DemoPass!123',
      role: 'COMMUTER',
    },
    {
      id: 'usr-admin-1',
      name: 'Meera Deshmukh (Demo Traffic Admin)',
      email: 'admin@traffix.demo',
      pass: 'AdminPass!123',
      role: 'ADMIN',
    },
    {
      id: 'usr-signal-1',
      name: 'Rohan Patil (Demo Signal Operator)',
      email: 'signal@traffix.demo',
      pass: 'SignalPass!123',
      role: 'SIGNAL_OPERATOR',
    },
    {
      id: 'usr-emerg-1',
      name: 'Dr. Kavita Rao (Demo Emergency Operator)',
      email: 'emergency@traffix.demo',
      pass: 'EmergPass!123',
      role: 'EMERGENCY_OPERATOR',
    },
  ];

  const nodes = [
    { id: 'node-central', ref: 'N01', name: 'Central Bus Terminus', lat: 15.8520, lng: 74.5010, junction: 1, zone: 'Central Core' },
    { id: 'node-chennamma', ref: 'N02', name: 'Rani Chennamma Circle', lat: 15.8585, lng: 74.5045, junction: 1, zone: 'Central Core' },
    { id: 'node-congress', ref: 'N03', name: 'Congress Road Junction', lat: 15.8470, lng: 74.4960, junction: 1, zone: 'South Corridor' },
    { id: 'node-tilakwadi', ref: 'N04', name: 'Tilakwadi First Gate', lat: 15.8405, lng: 74.4920, junction: 0, zone: 'Tilakwadi' },
    { id: 'node-camp', ref: 'N05', name: 'Camp Artillery Chowk', lat: 15.8535, lng: 74.4875, junction: 1, zone: 'Cantonment' },
    { id: 'node-fort', ref: 'N06', name: 'Fort Lake Circle', lat: 15.8640, lng: 74.5130, junction: 1, zone: 'East Arterial' },
    { id: 'node-kle', ref: 'N07', name: 'KLE Medical Corridor', lat: 15.8695, lng: 74.5025, junction: 1, zone: 'North Medical' },
    { id: 'node-nehru', ref: 'N08', name: 'Nehru Nagar Bypass', lat: 15.8730, lng: 74.5145, junction: 0, zone: 'North Bypass' },
    { id: 'node-shahpur', ref: 'N09', name: 'Shahpur Market Cross', lat: 15.8445, lng: 74.5110, junction: 1, zone: 'Shahpur' },
    { id: 'node-vadgaon', ref: 'N10', name: 'Vadgaon Arterial South', lat: 15.8375, lng: 74.5150, junction: 0, zone: 'Vadgaon' },
    { id: 'node-udyambag', ref: 'N11', name: 'Udyambag Industrial Gate', lat: 15.8330, lng: 74.4995, junction: 0, zone: 'Industrial Zone' },
    { id: 'node-college', ref: 'N12', name: 'College Road Plaza', lat: 15.8555, lng: 74.4975, junction: 0, zone: 'Central Core' },
    { id: 'node-bogarves', ref: 'N13', name: 'Bogarves Commercial Hub', lat: 15.8505, lng: 74.5095, junction: 0, zone: 'Central Core' },
    { id: 'node-hindalga', ref: 'N14', name: 'Hindalga West Ring', lat: 15.8575, lng: 74.4785, junction: 0, zone: 'West Ring' },
    { id: 'node-kanabargi', ref: 'N15', name: 'Kanabargi Ring East', lat: 15.8665, lng: 74.5250, junction: 0, zone: 'East Ring' },
    { id: 'node-station', ref: 'N16', name: 'Railway Station Forecourt', lat: 15.8460, lng: 74.5040, junction: 1, zone: 'Central Core' },
  ];

  // Road segments carefully calibrated so shortest-distance (congested core) != fastest-time (outer bypass)
  const segments = [
    { id: 'seg-01', name: 'Khade Bazaar Central Spine', s: 'node-central', e: 'node-chennamma', len: 820, cap: 1200, spd: 32, cong: 0.72 },
    { id: 'seg-02', name: 'College Road Avenue', s: 'node-college', e: 'node-chennamma', len: 840, cap: 1100, spd: 30, cong: 0.76 },
    { id: 'seg-03', name: 'Central-College Link', s: 'node-central', e: 'node-college', len: 560, cap: 1000, spd: 30, cong: 0.68 },
    { id: 'seg-04', name: 'Congress Inner Corridor', s: 'node-congress', e: 'node-central', len: 790, cap: 1300, spd: 35, cong: 0.65 },
    { id: 'seg-05', name: 'Tilakwadi Main Road', s: 'node-tilakwadi', e: 'node-congress', len: 860, cap: 1400, spd: 38, cong: 0.58 },
    { id: 'seg-06', name: 'Congress-College Connector', s: 'node-congress', e: 'node-college', len: 970, cap: 1150, spd: 34, cong: 0.64 },
    { id: 'seg-07', name: 'Camp Artillery Road', s: 'node-congress', e: 'node-camp', len: 1180, cap: 1800, spd: 55, cong: 0.24 },
    { id: 'seg-08', name: 'Tilakwadi-Camp Ring', s: 'node-tilakwadi', e: 'node-camp', len: 1540, cap: 2200, spd: 65, cong: 0.18 },
    { id: 'seg-09', name: 'Camp-College Connector', s: 'node-camp', e: 'node-college', len: 1100, cap: 1700, spd: 50, cong: 0.30 },
    { id: 'seg-10', name: 'Hindalga West Expressway', s: 'node-camp', e: 'node-hindalga', len: 1080, cap: 2600, spd: 70, cong: 0.14 },
    { id: 'seg-11', name: 'North West Ring Arterial', s: 'node-hindalga', e: 'node-kle', len: 2950, cap: 2800, spd: 72, cong: 0.16 },
    { id: 'seg-12', name: 'KLE Hospital Highway', s: 'node-chennamma', e: 'node-kle', len: 1260, cap: 1900, spd: 48, cong: 0.44 },
    { id: 'seg-13', name: 'Nehru Nagar Bypass North', s: 'node-kle', e: 'node-nehru', len: 1380, cap: 2600, spd: 68, cong: 0.19 },
    { id: 'seg-14', name: 'Fort-Nehru Ring Road', s: 'node-fort', e: 'node-nehru', len: 1050, cap: 2500, spd: 66, cong: 0.22 },
    { id: 'seg-15', name: 'Fort Lake Boulevard', s: 'node-chennamma', e: 'node-fort', len: 1120, cap: 2000, spd: 52, cong: 0.36 },
    { id: 'seg-16', name: 'Bogarves-Fort Link', s: 'node-bogarves', e: 'node-fort', len: 1560, cap: 1900, spd: 52, cong: 0.32 },
    { id: 'seg-17', name: 'Bogarves Market Street', s: 'node-central', e: 'node-bogarves', len: 940, cap: 1250, spd: 34, cong: 0.62 },
    { id: 'seg-18', name: 'Station-Central Feeder', s: 'node-station', e: 'node-central', len: 740, cap: 1350, spd: 36, cong: 0.54 },
    { id: 'seg-19', name: 'Station-Bogarves Avenue', s: 'node-station', e: 'node-bogarves', len: 780, cap: 1600, spd: 46, cong: 0.38 },
    { id: 'seg-20', name: 'Station-Congress Link', s: 'node-congress', e: 'node-station', len: 880, cap: 1500, spd: 42, cong: 0.42 },
    { id: 'seg-21', name: 'Shahpur Station Road', s: 'node-station', e: 'node-shahpur', len: 790, cap: 1450, spd: 40, cong: 0.47 },
    { id: 'seg-22', name: 'Shahpur-Bogarves Bypass', s: 'node-shahpur', e: 'node-bogarves', len: 700, cap: 1650, spd: 46, cong: 0.35 },
    { id: 'seg-23', name: 'Vadgaon-Shahpur Corridor', s: 'node-vadgaon', e: 'node-shahpur', len: 910, cap: 1750, spd: 50, cong: 0.28 },
    { id: 'seg-24', name: 'Udyambag-Tilakwadi Belt', s: 'node-udyambag', e: 'node-tilakwadi', len: 1180, cap: 2100, spd: 58, cong: 0.25 },
    { id: 'seg-25', name: 'Udyambag-Vadgaon South Ring', s: 'node-udyambag', e: 'node-vadgaon', len: 1780, cap: 2400, spd: 64, cong: 0.20 },
    { id: 'seg-26', name: 'Kanabargi East Bypass', s: 'node-fort', e: 'node-kanabargi', len: 1340, cap: 2500, spd: 68, cong: 0.17 },
    { id: 'seg-27', name: 'Kanabargi-Shahpur Ring', s: 'node-shahpur', e: 'node-kanabargi', len: 2880, cap: 2600, spd: 68, cong: 0.19 },
    { id: 'seg-28', name: 'Kanabargi-Nehru Outer Loop', s: 'node-kanabargi', e: 'node-nehru', len: 1360, cap: 2700, spd: 70, cong: 0.15 },
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const tx = db.transaction(() => {
    for (const u of demoUsers) {
      const hash = bcrypt.hashSync(u.pass, 10);
      insertUser.run(u.id, u.name, u.email, hash, u.role, now, now);
    }

    const insertNode = db.prepare(`
      INSERT INTO road_nodes (id, external_ref, name, latitude, longitude, is_junction, zone, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const n of nodes) {
      insertNode.run(n.id, n.ref, n.name, n.lat, n.lng, n.junction, n.zone, JSON.stringify({ seeded: true }));
    }

    const insertSeg = db.prepare(`
      INSERT INTO road_segments (id, name, start_node_id, end_node_id, geometry_json, length_meters, capacity_vph, speed_limit_kmh, current_congestion, closure_status, weather_factor, one_way, is_simulated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 1.0, 0, 1)
    `);
    for (const s of segments) {
      const sn = nodeMap.get(s.s)!;
      const en = nodeMap.get(s.e)!;
      const midLat = Number(((sn.lat + en.lat) / 2 + (s.len % 7 - 3) * 0.00025).toFixed(5));
      const midLng = Number(((sn.lng + en.lng) / 2 + (s.len % 5 - 2) * 0.00025).toFixed(5));
      const geometry: Array<[number, number]> = [
        [sn.lat, sn.lng],
        [midLat, midLng],
        [en.lat, en.lng],
      ];
      insertSeg.run(s.id, s.name, s.s, s.e, JSON.stringify(geometry), s.len, s.cap, s.spd, s.cong);
    }

    // Seed historical/simulated traffic observations (last 24 hours across segments for regression model training)
    const insertObs = db.prepare(`
      INSERT INTO traffic_observations (id, segment_id, observed_at, vehicle_count, average_speed_kmh, queue_length, weather_condition, source, is_simulated)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SIMULATED_HISTORICAL_PROFILE', 1)
    `);

    const baseTime = Date.now();
    let obsIdx = 1;
    for (const s of segments) {
      for (let h = 24; h >= 0; h -= 2) {
        const obsDate = new Date(baseTime - h * 3600 * 1000);
        const hour = obsDate.getHours();
        const peakBoost =
          (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20) ? 0.22 : hour >= 23 || hour <= 5 ? -0.15 : 0.0;
        const density = Math.min(0.95, Math.max(0.08, s.cong + peakBoost + ((obsIdx % 5) - 2) * 0.02));
        const vehCount = Math.round(s.cap * density * 0.35);
        const avgSpeed = Number(Math.max(8, s.spd * (1 - density * 0.68)).toFixed(1));
        const queueLen = Math.round(density * 28);
        insertObs.run(`obs-${obsIdx++}`, s.id, obsDate.toISOString(), vehCount, avgSpeed, queueLen, 'CLEAR');
      }
    }

    // Seed 6 configurable signalized junctions
    const junctionDefs = [
      {
        id: 'junc-chennamma',
        nodeId: 'node-chennamma',
        name: 'Rani Chennamma Circle',
        approaches: ['North (KLE)', 'South (Central)', 'East (Fort)', 'West (College)'],
        lanes: 4,
        phases: [
          { phaseId: 'P1', approach: 'North-South Arterial', greenSec: 34, amberSec: 4, redSec: 42 },
          { phaseId: 'P2', approach: 'East-West Corridor', greenSec: 38, amberSec: 4, redSec: 38 },
        ],
      },
      {
        id: 'junc-central',
        nodeId: 'node-central',
        name: 'Central Bus Terminus Junction',
        approaches: ['North (Chennamma)', 'South (Congress)', 'East (Bogarves)'],
        lanes: 3,
        phases: [
          { phaseId: 'P1', approach: 'Terminus Main Flow', greenSec: 36, amberSec: 4, redSec: 40 },
          { phaseId: 'P2', approach: 'Bogarves Feeder', greenSec: 36, amberSec: 4, redSec: 40 },
        ],
      },
      {
        id: 'junc-congress',
        nodeId: 'node-congress',
        name: 'Congress Road Signal',
        approaches: ['North (College)', 'South (Tilakwadi)', 'West (Camp)', 'East (Station)'],
        lanes: 4,
        phases: [
          { phaseId: 'P1', approach: 'Congress North-South', greenSec: 40, amberSec: 4, redSec: 36 },
          { phaseId: 'P2', approach: 'Camp-Station Cross', greenSec: 32, amberSec: 4, redSec: 44 },
        ],
      },
      {
        id: 'junc-fort',
        nodeId: 'node-fort',
        name: 'Fort Lake Circle',
        approaches: ['West (Chennamma)', 'North (Nehru)', 'East (Kanabargi)', 'South (Bogarves)'],
        lanes: 4,
        phases: [
          { phaseId: 'P1', approach: 'East-West Ring', greenSec: 42, amberSec: 4, redSec: 34 },
          { phaseId: 'P2', approach: 'North-South Arterial', greenSec: 30, amberSec: 4, redSec: 46 },
        ],
      },
      {
        id: 'junc-kle',
        nodeId: 'node-kle',
        name: 'KLE Medical Corridor Gate',
        approaches: ['South (Chennamma)', 'North (Nehru)', 'West (Hindalga)'],
        lanes: 4,
        phases: [
          { phaseId: 'P1', approach: 'Hospital Main Gate', greenSec: 35, amberSec: 4, redSec: 41 },
          { phaseId: 'P2', approach: 'Bypass Ring Flow', greenSec: 37, amberSec: 4, redSec: 39 },
        ],
      },
      {
        id: 'junc-station',
        nodeId: 'node-station',
        name: 'Railway Station Forecourt',
        approaches: ['North (Central)', 'East (Bogarves)', 'South (Shahpur)', 'West (Congress)'],
        lanes: 3,
        phases: [
          { phaseId: 'P1', approach: 'Station Forecourt Axis', greenSec: 33, amberSec: 4, redSec: 43 },
          { phaseId: 'P2', approach: 'Shahpur-Congress Link', greenSec: 39, amberSec: 4, redSec: 37 },
        ],
      },
    ];

    const insertJunction = db.prepare(`
      INSERT INTO junctions (id, node_id, name, latitude, longitude, approaches_json, lanes_count, min_green_sec, max_green_sec, cycle_length_sec, current_phases_json, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 15, 75, 80, ?, 1)
    `);
    for (const j of junctionDefs) {
      const n = nodeMap.get(j.nodeId)!;
      insertJunction.run(
        j.id,
        j.nodeId,
        j.name,
        n.lat,
        n.lng,
        JSON.stringify(j.approaches),
        j.lanes,
        JSON.stringify(j.phases)
      );
    }

    // Seed sample incidents (1 verified congestion, 1 pending collision, 1 resolved breakdown)
    const insertIncident = db.prepare(`
      INSERT INTO incidents (
        id, reporter_id, type, description, latitude, longitude, road_segment_id,
        severity, estimated_severity, severity_confidence, severity_reasons_json,
        status, image_url, possible_duplicate, canonical_incident_id, duplicate_score, duplicate_reason,
        verified_by, created_at, updated_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, NULL, ?, ?, ?, ?)
    `);

    const minsAgo = (m: number) => new Date(baseTime - m * 60000).toISOString();

    insertIncident.run(
      'inc-seed-1',
      'usr-commuter-1',
      'CONGESTION',
      'Heavy afternoon queue build-up near College Road bus stop restricting left lane.',
      15.8565,
      74.5005,
      'seg-02',
      'HIGH',
      'HIGH',
      0.84,
      JSON.stringify(['High baseline corridor load (76%)', 'Peak commercial lane bottleneck']),
      'VERIFIED',
      'usr-admin-1',
      minsAgo(45),
      minsAgo(40),
      null
    );

    insertIncident.run(
      'inc-seed-2',
      'usr-commuter-1',
      'ACCIDENT',
      'Minor two-wheeler collision near Central Bus Terminus north exit, waiting for clearance.',
      15.8548,
      74.5025,
      'seg-01',
      'MEDIUM',
      'HIGH',
      0.79,
      JSON.stringify(['Incident type ACCIDENT', 'High-density central spine segment']),
      'PENDING',
      null,
      minsAgo(18),
      minsAgo(18),
      null
    );

    insertIncident.run(
      'inc-seed-3',
      'usr-commuter-1',
      'BREAKDOWN',
      'Stalled delivery van cleared from Shahpur Station Road shoulder.',
      15.8452,
      74.5075,
      'seg-21',
      'LOW',
      'LOW',
      0.88,
      JSON.stringify(['Single-vehicle shoulder breakdown']),
      'RESOLVED',
      'usr-admin-1',
      minsAgo(160),
      minsAgo(95),
      minsAgo(95)
    );

    // Seed emergency vehicles
    const insertVehicle = db.prepare(`
      INSERT INTO emergency_vehicles (id, operator_id, vehicle_type, registration_label, available, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    insertVehicle.run('veh-amb-01', 'usr-emerg-1', 'AMBULANCE', 'KA-22-EM-108 (ALS Unit 1)', now);
    insertVehicle.run('veh-fire-02', 'usr-emerg-1', 'FIRE_TRUCK', 'KA-22-FR-101 (Rapid Tender 2)', now);

    // Seed audit log entry for seeded data provenance
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, actor_email, action, target_type, target_id, before_summary, after_summary, created_at)
      VALUES (?, 'system-seed', 'system@traffix.demo', 'SEED_DEMO_DATA', 'NETWORK', 'belagavi-sim-grid', 'Empty database', 'Seeded 16 nodes, 28 segments, 6 junctions, 4 demo accounts (DEV ONLY)', ?)
    `).run('aud-seed-1', now);
  });

  tx();
}
