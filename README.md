# TRAFFIX — Intelligent Traffic Management & Route Optimization System

Full-stack smart-city traffic operations web application implementing server-side Dijkstra and A* multi-factor route optimization, duplicate-aware incident reporting, 15/30-minute congestion forecasting, non-destructive closure/blockage simulation, adaptive traffic signal simulation, emergency priority routing, real-time Socket.IO broadcasts, and immutable audit logging.

> **Simulation Boundary Notice:** Where live municipal traffic feeds, roadside signal controllers, or active emergency dispatch telemetry are unavailable, TRAFFIX uses a clearly labelled deterministic simulation dataset (`SIMULATED DATA`). It never presents simulated conditions as live city observations.

---

## Technology Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS v4, React Router, Leaflet + OpenStreetMap, Recharts, Socket.IO Client, Axios
- **Backend:** Node.js, Express, TypeScript, Socket.IO, Zod validation, JWT (Access + Refresh tokens), bcryptjs, Helmet, CORS, Express Rate Limit, Multer
- **Database:** Relational SQLite (`better-sqlite3` with `PRAGMA foreign_keys = ON`, WAL mode, transactional writes, indexes, and automatic seed initialization)
- **Testing:** Vitest + Supertest

---

## Quick Start

```bash
npm install
npm run db:seed   # optional: server auto-seeds on first startup
npm run dev       # starts Express + Socket.IO + Vite on http://localhost:3000
```

Run tests and verification:

```bash
npm test          # Vitest + Supertest acceptance suite
npm run lint      # TypeScript typecheck
npm run build     # Vite production bundle
```

---

## Development-Only Demo Accounts

These seeded accounts are for **development and demonstration only**:

| Role | Email | Password |
| :--- | :--- | :--- |
| Public Commuter | `commuter@traffix.demo` | `DemoPass!123` |
| Traffic Administrator | `admin@traffix.demo` | `AdminPass!123` |
| Signal Control Operator | `signal@traffix.demo` | `SignalPass!123` |
| Emergency Operator | `emergency@traffix.demo` | `EmergPass!123` |

---

## Architecture & Request Flow

```
Frontend (React + Typed Axios API + Socket.IO Client)
   │
   ├── REST (/api/*) ──► Express Middleware (RequestId, Helmet, CORS, RateLimit, JWT Auth, Zod)
   │                        │
   │                        ▼
   │                     Services Layer (Transactions + Audit Log)
   │                        │
   │                        ├── Algorithms (Dijkstra, A*, Duplicate/Severity, BFS Impact, Linear Regression, Webster Signal Sim, Emergency Priority)
   │                        └── SQLite DB (Normalized Tables + Foreign Keys + Indexes)
   │
   └── WebSocket ──────► Socket.IO Rooms (public:traffic, admin:ops, signal:ops, emergency:ops, user:<id>)
```

---

## Key API Endpoints (Documented at `/api/docs`)

- `GET /api/health` — Service & database health check
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `GET/PATCH /api/auth/me`
- `GET /api/routes/network`, `GET /api/routes/geocode`, `GET /api/routes/alternatives`, `GET/POST/DELETE /api/routes/saved`
- `GET/POST /api/incidents`, `GET /api/incidents/:id`, `PATCH /api/incidents/:id/status`, `POST /api/incidents/:id/impact-analysis`
- `GET/POST /api/simulations/closures`, `POST /api/simulations/:id/end`, `POST /api/simulations/traffic-controls`
- `GET /api/predictions`, `POST /api/predictions/run`
- `GET /api/signals/junctions`, `POST /api/signals/optimize`, `POST /api/signals/plans/:id/approve`, `GET /api/signals/history`
- `GET /api/emergency/vehicles`, `GET/POST /api/emergency/trips`, `PATCH /api/emergency/trips/:id/status`, `POST /api/emergency/trips/:id/priority-route`
- `GET /api/analytics/overview`, `GET /api/analytics/audit-logs`, `GET /api/analytics/export/csv`

---

## Known Limitations

- Uses an in-process SQLite database (`data/traffix.db`) instead of an external PostgreSQL/PostGIS cluster so the application runs immediately in zero-config sandbox environments; relational schema and parameterized queries are structured for straightforward migration.
- Uses an in-process chronological train/test multivariable regression baseline for 15/30-minute predictions rather than an external Python FastAPI microservice.
- External live traffic/weather feeds are mocked behind modular provider adapters (`SIMULATED_GRAPH`, `SIMULATED_WEATHER`) unless live API credentials are configured.
