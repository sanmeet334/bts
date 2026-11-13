import React from 'react';
import { Link } from 'react-router-dom';
import { Navigation, TrendingUp } from 'lucide-react';
import { Dashboard } from '../components/Dashboard';
import { WorkspaceLayout } from '../components/Layout';

export function DashboardPage() {
  return (
    <WorkspaceLayout
      title="Historical Traffic & Travel-Time Analytics"
      breadcrumb="Dashboard"
      actions={
        <div className="flex items-center gap-2">
          <Link
            to="/predictions"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0D1424] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Forecasts</span>
          </Link>
          <Link
            to="/navigate"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-500 whitespace-nowrap shrink-0"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Route Optimizer</span>
          </Link>
        </div>
      }
    >
      <Dashboard />
    </WorkspaceLayout>
  );
}
