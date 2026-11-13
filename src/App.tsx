import React, { useEffect, useState } from 'react';
import { APIProvider, APILoadingStatus, useApiLoadingStatus } from '@vis.gl/react-google-maps';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getGoogleMapsApiKey } from './config/maps';
import { AuthProvider } from './context/AuthContext';
import { MapsStatusProvider } from './context/MapsContext';
import { ToastProvider } from './context/ToastContext';
import { AdminPage } from './pages/AdminPage';
import { LoginPage, ProfilePage, RegisterPage } from './pages/AuthPages';
import { DashboardPage } from './pages/DashboardPage';
import { EmergencyPage } from './pages/EmergencyPage';
import { IncidentDetailPage } from './pages/IncidentDetailPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { LandingPage } from './pages/LandingPage';
import { NavigatePage } from './pages/NavigatePage';
import { PredictionsPage } from './pages/PredictionsPage';
import { SignalsPage } from './pages/SignalsPage';

function LoadedMapsStatusBridge({
  authFailureMessage,
  children,
}: {
  authFailureMessage: string | null;
  children: React.ReactNode;
}) {
  const loadingStatus = useApiLoadingStatus();
  return (
    <MapsStatusProvider
      value={{
        hasApiKey: true,
        authFailureMessage,
        loadingStatus,
      }}
    >
      {children}
    </MapsStatusProvider>
  );
}

export default function App() {
  const mapsApiKey = getGoogleMapsApiKey();
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [authFailureMessage, setAuthFailureMessage] = useState<string | null>(null);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    const onAuth = (ev: Event) => {
      const detail = (ev as CustomEvent<string | undefined>).detail;
      setAuthFailureMessage(
        detail ||
          'Google Maps API key authentication failed. Verify the key and enabled Google Maps APIs.'
      );
    };

    window.addEventListener('gmp-quota-exceeded', onQuota);
    window.addEventListener('gmp-auth-failure', onAuth);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuota);
      window.removeEventListener('gmp-auth-failure', onAuth);
    };
  }, []);

  const appTree = (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/navigate" element={<NavigatePage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/incidents/:id" element={<IncidentDetailPage />} />
            <Route path="/predictions" element={<PredictionsPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/signals" element={<SignalsPage />} />
            <Route path="/emergency" element={<EmergencyPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );

  return (
    <>
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {mapsApiKey ? (
        <APIProvider
          apiKey={mapsApiKey}
          libraries={['places', 'marker', 'routes']}
          onError={() => {
            setAuthFailureMessage(
              'Failed to load Google Maps JavaScript API. Check your API key, billing status, and enabled APIs.'
            );
          }}
        >
          <LoadedMapsStatusBridge authFailureMessage={authFailureMessage}>
            {appTree}
          </LoadedMapsStatusBridge>
        </APIProvider>
      ) : (
        <MapsStatusProvider
          value={{
            hasApiKey: false,
            authFailureMessage: null,
            loadingStatus: APILoadingStatus.NOT_LOADED,
          }}
        >
          {appTree}
        </MapsStatusProvider>
      )}
    </>
  );
}
