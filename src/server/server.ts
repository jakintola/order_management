import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { ExchangeConnector } from './exchange.js';
import config from './config.js';
import { join } from 'path';
import { createServer as createViteServer } from 'vite';

const isProduction = config.NODE_ENV === 'production';

async function createApp() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'healthy' });
  });

  // Initialize exchange connection
  try {
    console.log('Initializing exchange connection...');
    await ExchangeConnector.initialize();
    console.log('Exchange connection initialized successfully');
  } catch (error) {
    console.error('Failed to initialize exchange:', error);
    process.exit(1);
  }

  if (isProduction) {
    app.use(express.static(join(process.cwd(), 'dist/client')));
    app.get('*', (_req, res) => {
      res.sendFile(join(process.cwd(), 'dist/client', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  wss.on('connection', (ws) => {
    console.log('Client connected');
    ExchangeConnector.addClient(ws);

    ws.on('close', () => {
      console.log('Client disconnected');
      ExchangeConnector.removeClient(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  const port = config.PORT;
  server.listen(port, () => {
    console.log(`Server running on port ${port} in ${config.NODE_ENV} mode`);
  });

  return { app, server };
}

createApp().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});