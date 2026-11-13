import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { env } from './src/server/config/env.js';
import { getDb } from './src/server/db/connection.js';
import { createApp } from './src/server/app.js';
import { initSocketServer } from './src/server/realtime/socket.js';

async function startServer() {
  // Initialize SQLite database, schema, and seed data before serving traffic
  getDb();

  const app = createApp();
  const httpServer = http.createServer(app);

  // Attach Socket.IO on same port 3000
  initSocketServer(httpServer);

  if (env.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(env.port, '0.0.0.0', () => {
    console.log(`TRAFFIX server listening on http://0.0.0.0:${env.port} (${env.nodeEnv})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start TRAFFIX server:', err);
  process.exit(1);
});
