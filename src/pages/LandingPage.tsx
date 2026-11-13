import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Navigation, AlertTriangle, TrendingUp, ShieldCheck } from 'lucide-react';
import { PublicHeader } from '../components/Layout';
import { analyticsApi } from '../services/api';
import heroCorridorImg from '../assets/images/hero_urban_corridor_1794548898212.jpg';

export function LandingPage() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    analyticsApi
      .getPublicSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex flex-col">
      <PublicHeader />

      <main className="flex-1">
        {/* Hero Split */}
        <section className="mx-auto max-w-7xl px-6 pt-12 pb-10 lg:pt-16 lg:pb-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <p className="text-xs font-mono text-cyan-400 tracking-wide">
                SMART-CITY TRAFFIC OPERATIONS · SIMULATED BASELINE NETWORK
              </p>
              <h1
                className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1] font-display max-w-xl"
                style={{ textWrap: 'balance' }}
              >
                Intelligent route optimization and urban corridor control.
              </h1>
              <p className="text-base text-slate-300 leading-relaxed max-w-xl">
                TRAFFIX unifies server-side Dijkstra and A* multi-factor routing, duplicate-aware
                incident verification, 15–30 minute congestion forecasting, network closure
                simulation, and emergency green-corridor planning on one verifiable platform.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Link
                  to="/navigate"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap"
                >
                  <span>Open Route Optimizer</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/incidents"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-5 py-3 text-sm font-medium text-slate-200 hover:bg-slate-800/70 transition-colors whitespace-nowrap"
                >
                  <span>Report an Incident</span>
                </Link>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[280px] lg:min-h-[380px] rounded-xl overflow-hidden border border-slate-800 bg-[#111827]">
                <img
                  src={heroCorridorImg}
                  alt="Aerial twilight view of smart-city arterial interchange"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#090E1A]/90 via-[#090E1A]/20 to-transparent" />
                <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between text-xs text-slate-200">
                  <span>16-Node Arterial Road Graph · 28 Bidir Corridors</span>
                  <span className="font-mono text-cyan-300">SIMULATED DATA</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4-column live KPI strip below hero */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4 border-t border-slate-800/80 pt-8">
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5">
              <p className="text-xs text-slate-400">Monitored Road Segments</p>
              <p className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
                {loading ? '—' : summary?.networkSummary?.totalSegments ?? 28}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {loading ? 'Loading...' : `${summary?.networkSummary?.openSegments ?? 0} open · simulated`}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5">
              <p className="text-xs text-slate-400">Avg Network Load</p>
              <p className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
                {loading ? '—' : `${summary?.networkSummary?.avgCongestionPct ?? 0}%`}
              </p>
              <p className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
                {loading ? 'Loading...' : `${summary?.networkSummary?.avgSpeedKmh ?? 0} km/h mean speed`}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5">
              <p className="text-xs text-slate-400">Verified Active Incidents</p>
              <p className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
                {loading ? '—' : summary?.verifiedIncidentsCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-400">Admin-verified network hazards</p>
            </div>
            <div className="rounded-xl border border-slate-800/80 bg-[#0D1424] p-5">
              <p className="text-xs text-slate-400">Forecast Risk (+15m / +30m)</p>
              <p className="mt-2 text-2xl font-semibold text-white font-mono tabular-nums">
                {loading
                  ? '—'
                  : `${summary?.predictionStats?.avg15MinRisk ?? 0} / ${
                      summary?.predictionStats?.avg30MinRisk ?? 0
                    }`}
              </p>
              <p className="mt-1 text-xs text-slate-400">Scale 0–100 · Simulated baseline</p>
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section className="mx-auto max-w-7xl px-6 py-12 border-t border-slate-800/70">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold text-white font-display">
              Integrated Modules Backed by Server-Side Algorithms
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Every route search, incident check, prediction batch, and signal timing plan runs on
              the backend with relational persistence and real-time Socket.IO synchronization.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <Link
              to="/navigate"
              className="group rounded-xl border border-slate-800/80 bg-[#0D1424] p-6 hover:border-blue-500/40 transition-colors"
            >
              <Navigation className="w-5 h-5 text-blue-400" />
              <h3 className="mt-4 text-base font-semibold text-white group-hover:text-blue-300 transition-colors">
                01. Multi-Factor Routing
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Compare Shortest (Dijkstra), Fastest (Congestion-Weighted), and Recommended (A*
                multi-factor) routes with transparent score weights.
              </p>
            </Link>

            <Link
              to="/incidents"
              className="group rounded-xl border border-slate-800/80 bg-[#0D1424] p-6 hover:border-blue-500/40 transition-colors"
            >
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h3 className="mt-4 text-base font-semibold text-white group-hover:text-blue-300 transition-colors">
                02. Incident Intelligence
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Report obstructions by map pin with automatic nearby duplicate flagging, rule-based
                severity scoring, and admin verification.
              </p>
            </Link>

            <Link
              to="/predictions"
              className="group rounded-xl border border-slate-800/80 bg-[#0D1424] p-6 hover:border-blue-500/40 transition-colors"
            >
              <TrendingUp className="w-5 h-5 text-cyan-400" />
              <h3 className="mt-4 text-base font-semibold text-white group-hover:text-blue-300 transition-colors">
                03. 15–30m Forecasting
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Chronological train/test linear regression pipeline predicting segment density,
                speed, and MAE/RMSE error metrics.
              </p>
            </Link>

            <Link
              to="/admin"
              className="group rounded-xl border border-slate-800/80 bg-[#0D1424] p-6 hover:border-blue-500/40 transition-colors"
            >
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h3 className="mt-4 text-base font-semibold text-white group-hover:text-blue-300 transition-colors">
                04. Impact & Signal Lab
              </h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                Simulate road closures, optimize adaptive junction signals with before/after wait
                comparisons, and plan emergency corridors.
              </p>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 bg-[#080C16] px-6 py-6">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <span>TRAFFIX — Intelligent Traffic Management and Route Optimization System</span>
          <span>Simulated Traffic Baseline Active · OpenAPI at /api/docs</span>
        </div>
      </footer>
    </div>
  );
}
