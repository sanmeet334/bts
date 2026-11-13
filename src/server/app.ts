import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import authRoutes from './routes/authRoutes.js';
import docsRoutes from './routes/docsRoutes.js';
import emergencyRoutes from './routes/emergencyRoutes.js';
import incidentRoutes from './routes/incidentRoutes.js';
import predictionRoutes from './routes/predictionRoutes.js';
import routeRoutes from './routes/routeRoutes.js';
import signalRoutes from './routes/signalRoutes.js';
import simulationRoutes from './routes/simulationRoutes.js';
import { sendError } from './utils/response.js';

export function createApp() {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: env.clientOrigin === '*' ? '*' : [env.clientOrigin, 'http://localhost:3000'],
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Serve uploaded incident evidence images safely
  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

  // API Routes
  app.use('/api', docsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/routes', routeRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/simulations', simulationRoutes);
  app.use('/api/predictions', predictionRoutes);
  app.use('/api/signals', signalRoutes);
  app.use('/api/emergency', emergencyRoutes);
  app.use('/api/analytics', analyticsRoutes);

  // Unknown API routes return structured JSON 404
  app.use('/api', (_req, res) => {
    return sendError(res, 404, 'ENDPOINT_NOT_FOUND', 'API endpoint does not exist');
  });

  app.use(errorHandler);
  return app;
}
