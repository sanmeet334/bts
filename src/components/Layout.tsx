import React, { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Navigation,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Sliders,
  Ambulance,
  ShieldCheck,
  User,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const WORKSPACE_NAV = [
  { to: '/navigate', label: 'Route Optimizer', icon: Navigation },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { to: '/predictions', label: 'Predictions', icon: TrendingUp },
  { to: '/dashboard', label: 'Analytics Dashboard', icon: BarChart3 },
  { to: '/signals', label: 'Signal Control', icon: Sliders },
  { to: '/emergency', label: 'Emergency', icon: Ambulance },
  { to: '/admin', label: 'Admin & Impact', icon: ShieldCheck },
];

export function PublicHeader() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#090E1A]/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
        <Link
          to="/"
          className="text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          TRAFFIX
        </Link>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
          <Link to="/navigate" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Navigate
          </Link>
          <Link to="/incidents" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Incidents
          </Link>
          <Link to="/predictions" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Predictions
          </Link>
          <Link to="/dashboard" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Dashboard
          </Link>
          <Link to="/admin" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
            Operations
          </Link>
        </nav>

        <div className="hidden md:flex items-center shrink-0">
          {user ? (
            <Link
              to="/navigate"
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
            >
              Open Workspace
            </Link>
          ) : (
            <Link
              to="/login"
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden p-2 text-slate-300 hover:text-white"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#0D1424] px-6 py-4 space-y-3">
          {WORKSPACE_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="block text-sm text-slate-300 hover:text-white py-1"
            >
              {item.label}
            </Link>
          ))}
          <Link
            to={user ? '/profile' : '/login'}
            onClick={() => setMobileOpen(false)}
            className="block rounded-lg bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white"
          >
            {user ? 'Account Profile' : 'Sign In'}
          </Link>
        </div>
      )}
    </header>
  );
}

export function WorkspaceLayout({
  title,
  breadcrumb,
  actions,
  children,
}: {
  title: string;
  breadcrumb: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, logout, socketConnected } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col border-r border-slate-800/80 bg-[#0C1221] shrink-0">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800/80">
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap"
          >
            TRAFFIX
          </Link>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {WORKSPACE_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600/15 text-blue-300 border border-blue-500/25'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50 border border-transparent'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-slate-800/80 p-4 space-y-3">
          <div className="text-xs text-slate-400 space-y-1">
            <div className="flex items-center justify-between">
              <span>Simulation Baseline</span>
              <span className="font-mono text-cyan-400">ACTIVE</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Socket Feed</span>
              <span className={`font-mono ${socketConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                {socketConnected ? 'CONNECTED' : 'RECONNECTING'}
              </span>
            </div>
          </div>

          {user ? (
            <div className="pt-2 border-t border-slate-800/80 space-y-2">
              <Link
                to="/profile"
                className="flex items-center gap-2.5 text-sm text-slate-200 hover:text-white"
              >
                <User className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-xs">{user.name}</p>
                  <p className="truncate text-[11px] text-slate-400 font-mono">{user.role}</p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                className="w-full flex items-center justify-center gap-2 rounded-md border border-slate-700/80 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              state={{ from: location.pathname }}
              className="block w-full rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-[#0C1221] border-r border-slate-800 flex flex-col z-10">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <Link to="/" className="text-lg font-bold text-white font-display">
                TRAFFIX
              </Link>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {WORKSPACE_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                        isActive
                          ? 'bg-blue-600/15 text-blue-300'
                          : 'text-slate-400 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="border-t border-slate-800/80 p-4 space-y-3">
              <div className="text-xs text-slate-400 space-y-1">
                <div className="flex items-center justify-between">
                  <span>Simulation Baseline</span>
                  <span className="font-mono text-cyan-400">ACTIVE</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Socket Feed</span>
                  <span className={`font-mono ${socketConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {socketConnected ? 'CONNECTED' : 'RECONNECTING'}
                  </span>
                </div>
              </div>
              {user ? (
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <Link
                    to="/profile"
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-2.5 text-sm text-slate-200 hover:text-white"
                  >
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-xs">{user.name}</p>
                      <p className="truncate text-[11px] text-slate-400 font-mono">{user.role}</p>
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      logout();
                      setSidebarOpen(false);
                      navigate('/login');
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-md border border-slate-700/80 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  state={{ from: location.pathname }}
                  onClick={() => setSidebarOpen(false)}
                  className="block w-full rounded-lg bg-blue-600 px-4 py-2 text-center text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
                >
                  Sign In
                </Link>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-slate-800/80 bg-[#0B111E]/95 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-md border border-slate-800 text-slate-300 hover:text-white"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 truncate">
                TRAFFIX / {breadcrumb} · SIMULATED DATA
              </p>
              <h1 className="text-base sm:text-lg font-semibold text-white truncate font-display">
                {title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {actions}
            {!user && (
              <Link
                to="/login"
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
