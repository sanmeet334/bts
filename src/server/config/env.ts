import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:3000',
  databasePath:
    process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'traffix.db'),
  jwtSecret:
    process.env.JWT_SECRET || 'traffix-dev-jwt-secret-change-in-production-32ch',
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET || 'traffix-dev-refresh-secret-change-in-production',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '4h',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  routingProvider: process.env.ROUTING_PROVIDER || 'SIMULATED_GRAPH',
  liveRoutingApiUrl: process.env.LIVE_ROUTING_API_URL || '',
  liveRoutingApiKey: process.env.LIVE_ROUTING_API_KEY || '',
  weatherProvider: process.env.WEATHER_PROVIDER || 'SIMULATED_WEATHER',
  liveWeatherApiKey: process.env.LIVE_WEATHER_API_KEY || '',
  predictionServiceUrl: process.env.PREDICTION_SERVICE_URL || '',
  googleMapsApiKey:
    process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '',
};

