import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { UserDTO } from '../shared/types';
import { authApi } from '../services/api';
import { REFRESH_STORAGE_KEY, TOKEN_STORAGE_KEY } from '../services/apiClient';
import { useToast } from './ToastContext';

interface AuthContextValue {
  user: UserDTO | null;
  loading: boolean;
  socketConnected: boolean;
  socket: Socket | null;
  login: (email: string, password: string) => Promise<UserDTO>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    role?: 'COMMUTER' | 'EMERGENCY_OPERATOR';
    vehicleType?: 'AMBULANCE' | 'FIRE_TRUCK';
    registrationLabel?: string;
  }) => Promise<UserDTO>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const { pushToast } = useToast();

  const initSocket = useCallback(
    (token: string | null) => {
      const sock = io('/', {
        auth: token ? { token } : undefined,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1500,
      });

      sock.on('connect', () => {
        setSocketConnected(true);
      });
      sock.on('disconnect', () => {
        setSocketConnected(false);
      });
      sock.on('incident:verified', (msg: any) => {
        pushToast({
          variant: 'warning',
          title: 'Verified Incident Broadcast',
          message: `${msg?.payload?.type || 'Incident'} verified on ${msg?.payload?.roadSegmentName || 'corridor'}`,
        });
      });
      sock.on('road:status-changed', () => {
        pushToast({
          variant: 'info',
          title: 'Network Status Changed',
          message: 'Corridor status updated; active routes reflect current state.',
        });
      });

      setSocket(sock);
      return sock;
    },
    [pushToast]
  );

  useEffect(() => {
    let activeSock: Socket | null = null;
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      setLoading(false);
      activeSock = initSocket(null);
      return () => {
        activeSock?.disconnect();
      };
    }

    authApi
      .me()
      .then((u) => {
        setUser(u);
        activeSock = initSocket(localStorage.getItem(TOKEN_STORAGE_KEY));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(REFRESH_STORAGE_KEY);
        setUser(null);
        activeSock = initSocket(null);
      })
      .finally(() => setLoading(false));

    return () => {
      activeSock?.disconnect();
    };
  }, [initSocket]);

  const reconnectWithToken = useCallback(
    (token: string | null) => {
      socket?.disconnect();
      initSocket(token);
    },
    [socket, initSocket]
  );

  const login = async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken);
    localStorage.setItem(REFRESH_STORAGE_KEY, res.refreshToken);
    setUser(res.user);
    reconnectWithToken(res.accessToken);
    return res.user;
  };

  const register = async (payload: {
    name: string;
    email: string;
    password: string;
    role?: 'COMMUTER' | 'EMERGENCY_OPERATOR';
    vehicleType?: 'AMBULANCE' | 'FIRE_TRUCK';
    registrationLabel?: string;
  }) => {
    const res = await authApi.register(payload);
    localStorage.setItem(TOKEN_STORAGE_KEY, res.accessToken);
    localStorage.setItem(REFRESH_STORAGE_KEY, res.refreshToken);
    setUser(res.user);
    reconnectWithToken(res.accessToken);
    return res.user;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(REFRESH_STORAGE_KEY);
    setUser(null);
    reconnectWithToken(null);
  };

  const refreshUser = async () => {
    const u = await authApi.me();
    setUser(u);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        socketConnected,
        socket,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
