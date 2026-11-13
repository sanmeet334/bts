import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { env } from '../config/env.js';
import { AuthPayload, verifyAccessToken } from '../middleware/auth.js';

let io: SocketIOServer | null = null;

interface AuthedSocket extends Socket {
  user?: AuthPayload;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.clientOrigin === '*' ? '*' : [env.clientOrigin, 'http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.use((socket: AuthedSocket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.headers?.authorization?.replace('Bearer ', '') as string | undefined);

    if (token) {
      try {
        socket.user = verifyAccessToken(token);
      } catch {
        // Invalid token stays unauthenticated (restricted to public traffic room)
      }
    }
    next();
  });

  io.on('connection', (socket: AuthedSocket) => {
    // Public room receives only sanitized verified incidents, road closures, and predictions
    socket.join('public:traffic');

    if (socket.user) {
      socket.join(`user:${socket.user.userId}`);
      if (socket.user.role === 'ADMIN') {
        socket.join('admin:ops');
        socket.join('signal:ops');
        socket.join('emergency:ops');
      } else if (socket.user.role === 'SIGNAL_OPERATOR') {
        socket.join('signal:ops');
      } else if (socket.user.role === 'EMERGENCY_OPERATOR') {
        socket.join('emergency:ops');
      }
    }

    socket.on('subscribe:room', (room: string, ack?: (res: { ok: boolean; error?: string }) => void) => {
      if (room === 'public:traffic') {
        socket.join(room);
        ack?.({ ok: true });
        return;
      }
      if (!socket.user) {
        ack?.({ ok: false, error: 'Authentication required for operational channels' });
        return;
      }
      if (room === 'admin:ops' && socket.user.role !== 'ADMIN') {
        ack?.({ ok: false, error: 'Forbidden room subscription' });
        return;
      }
      if (
        room === 'signal:ops' &&
        !['ADMIN', 'SIGNAL_OPERATOR'].includes(socket.user.role)
      ) {
        ack?.({ ok: false, error: 'Forbidden room subscription' });
        return;
      }
      if (
        room === 'emergency:ops' &&
        !['ADMIN', 'EMERGENCY_OPERATOR'].includes(socket.user.role)
      ) {
        ack?.({ ok: false, error: 'Forbidden room subscription' });
        return;
      }
      socket.join(room);
      ack?.({ ok: true });
    });
  });

  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function broadcastEvent(
  room: 'public:traffic' | 'admin:ops' | 'signal:ops' | 'emergency:ops' | string,
  event: string,
  payload: unknown
) {
  if (!io) return;
  io.to(room).emit(event, {
    event,
    payload,
    timestamp: new Date().toISOString(),
  });
}
