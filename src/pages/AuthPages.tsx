import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PublicHeader, WorkspaceLayout } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../services/api';

const DEMO_ACCOUNTS = [
  {
    label: 'Commuter (Demo)',
    email: 'commuter@traffix.demo',
    pass: 'DemoPass!123',
    role: 'COMMUTER',
  },
  {
    label: 'Traffic Admin (Demo)',
    email: 'admin@traffix.demo',
    pass: 'AdminPass!123',
    role: 'ADMIN',
  },
  {
    label: 'Signal Operator (Demo)',
    email: 'signal@traffix.demo',
    pass: 'SignalPass!123',
    role: 'SIGNAL_OPERATOR',
  },
  {
    label: 'Emergency Operator (Demo)',
    email: 'emergency@traffix.demo',
    pass: 'EmergPass!123',
    role: 'EMERGENCY_OPERATOR',
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectPath = (location.state as any)?.from || '/navigate';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      pushToast({
        variant: 'success',
        title: 'Signed In',
        message: `Authenticated as ${user.name} (${user.role})`,
      });
      navigate(redirectPath);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex flex-col">
      <PublicHeader />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-slate-800 bg-[#0D1424] p-6 sm:p-8">
          <div>
            <h1 className="text-2xl font-bold text-white font-display">Sign in to TRAFFIX</h1>
            <p className="mt-1 text-sm text-slate-400">
              Access incident reporting, role-authorized operations, and saved routes.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          <div className="border-t border-slate-800 pt-5">
            <p className="text-xs font-medium text-slate-400 mb-2.5">
              Development-Only Seeded Demo Accounts (Quick Fill)
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email);
                    setPassword(acc.pass);
                    setError(null);
                  }}
                  className="rounded-lg border border-slate-700/80 bg-[#090E1A] px-3 py-2 text-left text-xs hover:border-blue-500/50 transition-colors"
                >
                  <div className="font-medium text-slate-200">{acc.label}</div>
                  <div className="text-[11px] font-mono text-slate-400 truncate">{acc.role}</div>
                </button>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-slate-400">
            New commuter or emergency operator?{' '}
            <Link to="/register" className="text-blue-400 hover:underline">
              Create an account
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const { pushToast } = useToast();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'COMMUTER' | 'EMERGENCY_OPERATOR'>('COMMUTER');
  const [vehicleType, setVehicleType] = useState<'AMBULANCE' | 'FIRE_TRUCK'>('AMBULANCE');
  const [registrationLabel, setRegistrationLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await register({
        name,
        email,
        password,
        role,
        ...(role === 'EMERGENCY_OPERATOR'
          ? { vehicleType, registrationLabel: registrationLabel || undefined }
          : {}),
      });
      pushToast({
        variant: 'success',
        title: 'Account Created',
        message: `Welcome ${user.name}`,
      });
      navigate('/navigate');
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090E1A] text-slate-100 flex flex-col">
      <PublicHeader />
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-6 rounded-xl border border-slate-800 bg-[#0D1424] p-6 sm:p-8">
          <div>
            <h1 className="text-2xl font-bold text-white font-display">Create TRAFFIX Account</h1>
            <p className="mt-1 text-sm text-slate-400">
              Password requires 8+ characters, 1 uppercase letter, and 1 number.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Full Name</label>
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 chars, 1 uppercase, 1 digit"
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Account Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="COMMUTER">Public Commuter</option>
                <option value="EMERGENCY_OPERATOR">Emergency Vehicle Operator</option>
              </select>
            </div>

            {role === 'EMERGENCY_OPERATOR' && (
              <div className="space-y-3 rounded-lg border border-slate-800 bg-[#090E1A] p-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Vehicle Unit Type
                  </label>
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-700 bg-[#0D1424] px-3 py-2 text-sm text-white"
                  >
                    <option value="AMBULANCE">Ambulance</option>
                    <option value="FIRE_TRUCK">Fire Service Tender</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Vehicle Registration Label
                  </label>
                  <input
                    type="text"
                    value={registrationLabel}
                    onChange={(e) => setRegistrationLabel(e.target.value)}
                    placeholder="e.g. KA-22-EM-901"
                    className="w-full rounded-lg border border-slate-700 bg-[#0D1424] px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400">
            Already registered?{' '}
            <Link to="/login" className="text-blue-400 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { pushToast } = useToast();
  const [name, setName] = useState(user?.name || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user?.name]);

  if (!user) {
    return (
      <WorkspaceLayout title="Account Profile" breadcrumb="Profile">
        <div className="rounded-xl border border-slate-800 bg-[#0D1424] p-6 max-w-lg">
          <p className="text-sm text-slate-300">Please sign in to view your profile.</p>
          <Link
            to="/login"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white"
          >
            Sign In
          </Link>
        </div>
      </WorkspaceLayout>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await authApi.updateProfile(name);
      await refreshUser();
      pushToast({ variant: 'success', title: 'Profile Updated' });
    } catch (err: any) {
      pushToast({ variant: 'error', title: 'Update Failed', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceLayout title="Account Profile" breadcrumb="Profile">
      <div className="max-w-lg rounded-xl border border-slate-800 bg-[#0D1424] p-6 space-y-5">
        <div className="text-xs text-slate-400 space-y-1 border-b border-slate-800 pb-4">
          <p>
            Email: <span className="font-mono text-slate-200">{user.email}</span>
          </p>
          <p>
            Role: <span className="font-mono text-cyan-400">{user.role}</span>
          </p>
          <p>
            Status: <span className="font-mono text-emerald-400">{user.status}</span>
          </p>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Display Name</label>
            <input
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-[#090E1A] px-3.5 py-2.5 text-sm text-white"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>
    </WorkspaceLayout>
  );
}
