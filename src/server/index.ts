import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { join } from 'path';
import { createServer as createViteServer } from 'vite';
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient, DeliveryStatus, OrderStatus } from '@prisma/client';
import { orderService } from './services/OrderService.js';
import { communicationService } from './services/CommunicationService.js';
import { deliveryMonitoringService } from './services/DeliveryMonitoringService.js';
import { paymentVerificationService } from './services/PaymentVerificationService.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { ExchangeConnector } from './exchange.js';
import { aiService } from './services/AIService';
import { exchangeConnector as exchangeConnectorImport } from './exchange';

// Load environment variables
dotenvConfig();

async function createApp() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const prisma = new PrismaClient();

  // Security middleware
  app.use(helmet());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
  });
  app.use(limiter);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', mode: config.DEMO_MODE ? 'demo' : 'production' });
  });

  // Initialize exchange connection
  try {
    logger.info('Initializing exchange connection...');
    await ExchangeConnector.initialize();
    logger.info('Exchange connection initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize exchange', { error });
    process.exit(1);
  }

  // Handle WebSocket connections
  wss.on('connection', (ws) => {
    logger.info('New WebSocket connection established');
    
    // Add client to exchange connector for price updates
    exchangeConnectorImport.addClient(ws);
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        switch (data.type) {
          case 'chat':
            const response = await aiService.processMessage(data.message, data.platform);
            ws.send(JSON.stringify({ type: 'chat_response', data: response }));
            break;
            
          case 'order':
            if (config.DEMO_MODE) {
              ws.send(JSON.stringify({
                type: 'order_response',
                data: { status: 'success', message: 'Order processed in demo mode' }
              }));
            } else {
              // Handle real order processing here
            }
            break;
            
          default:
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: 'Unknown message type' }
            }));
        }
      } catch (error) {
        logger.error('Error processing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Error processing message' }
        }));
      }
    });
    
    ws.on('close', () => {
      exchangeConnectorImport.removeClient(ws);
      logger.info('WebSocket connection closed');
    });
  });

  // Serve static files in production
  if (config.NODE_ENV === 'production') {
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

  // Order management routes
  app.post('/api/orders', async (req, res) => {
    try {
      const order = await orderService.createOrder(req.body);
      res.json(order);
    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({ error: 'Failed to create order' });
    }
  });

  app.get('/api/orders/:id', async (req, res) => {
    try {
      const order = await prisma.order.findUnique({
        where: { id: req.params.id },
        include: {
          customer: true,
          items: true,
          deliveries: true,
        },
      });
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json(order);
    } catch (error) {
      console.error('Error fetching order:', error);
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  });

  // Delivery management routes
  app.post('/api/deliveries', async (req, res) => {
    try {
      const delivery = await orderService.processDelivery(req.body.orderId);
      // Start monitoring the delivery
      await deliveryMonitoringService.startMonitoring(delivery.id);
      res.json(delivery);
    } catch (error) {
      console.error('Error processing delivery:', error);
      res.status(500).json({ error: 'Failed to process delivery' });
    }
  });

  // Update delivery location
  app.post('/api/deliveries/:id/location', async (req, res) => {
    try {
      const { latitude, longitude } = req.body;
      await deliveryMonitoringService.updateLocation(req.params.id, { latitude, longitude });
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating delivery location:', error);
      res.status(500).json({ error: 'Failed to update delivery location' });
    }
  });

  // Complete delivery with cash collection
  app.post('/api/deliveries/:id/complete', async (req, res) => {
    try {
      const { cashCollected } = req.body;
      const delivery = await prisma.delivery.update({
        where: { id: req.params.id },
        data: {
          status: DeliveryStatus.COMPLETED,
          completedTime: new Date()
        },
        include: {
          order: {
            include: { customer: true }
          },
          agent: true
        }
      });

      // Stop monitoring
      await deliveryMonitoringService.stopMonitoring(delivery.id);

      // Record cash collection if CoD
      if (delivery.order.paymentMethod === 'CASH_ON_DELIVERY' && cashCollected) {
        await paymentVerificationService.recordCashCollection(delivery.id, cashCollected);
      } else {
        // For non-CoD orders, mark as paid immediately
        await prisma.order.update({
          where: { id: delivery.orderId },
          data: { 
            status: OrderStatus.DELIVERED,
            paymentStatus: 'PAID'
          }
        });
      }

      // Notify customer
      await communicationService.sendMessage(
        delivery.order.platform,
        delivery.order.customer.phone!,
        `Your order #${delivery.order.orderNumber} has been delivered! Thank you for choosing our service.`
      );

      res.json(delivery);
    } catch (error) {
      console.error('Error completing delivery:', error);
      res.status(500).json({ error: 'Failed to complete delivery' });
    }
  });

  // Record cash remittance
  app.post('/api/deliveries/:id/remittance', async (req, res) => {
    try {
      const { amount, proofUrl } = req.body;
      await paymentVerificationService.recordCashRemittance(req.params.id, amount, proofUrl);
      res.json({ success: true });
    } catch (error) {
      console.error('Error recording remittance:', error);
      res.status(500).json({ error: 'Failed to record remittance' });
    }
  });

  // Get agent remittance history
  app.get('/api/agents/:id/remittance-history', async (req, res) => {
    try {
      const agent = await prisma.user.findUnique({
        where: { id: req.params.id },
        select: {
          totalCollections: true,
          totalRemittances: true,
          remittanceRating: true,
          fraudIncidents: true,
          isRestricted: true,
          deliveries: {
            where: {
              OR: [
                { status: DeliveryStatus.DELIVERED_UNPAID },
                { status: DeliveryStatus.DELIVERED_PAID },
                { status: DeliveryStatus.PAYMENT_DISPUTED }
              ]
            },
            select: {
              id: true,
              status: true,
              cashCollected: true,
              cashRemitted: true,
              remittanceTime: true,
              fraudScore: true,
              fraudFlags: true,
              order: {
                select: {
                  orderNumber: true,
                  totalAmount: true
                }
              }
            }
          }
        }
      });

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      res.json(agent);
    } catch (error) {
      console.error('Error fetching agent remittance history:', error);
      res.status(500).json({ error: 'Failed to fetch remittance history' });
    }
  });

  app.post('/api/deliveries/:id/delay', async (req, res) => {
    try {
      const delivery = await orderService.handleDeliveryDelay(req.params.id);
      res.json(delivery);
    } catch (error) {
      console.error('Error handling delivery delay:', error);
      res.status(500).json({ error: 'Failed to handle delivery delay' });
    }
  });

  app.post('/api/orders/:id/redelivery', async (req, res) => {
    try {
      const redelivery = await orderService.requestRedelivery(req.params.id);
      res.json(redelivery);
    } catch (error) {
      console.error('Error requesting redelivery:', error);
      res.status(500).json({ error: 'Failed to request redelivery' });
    }
  });

  // Webhook routes for communication platforms
  app.post('/api/webhooks/telegram', (req, res) => {
    // Handle Telegram webhook
    res.sendStatus(200);
  });

  app.post('/api/webhooks/meta', (req, res) => {
    // Handle Facebook/Instagram webhook
    if (req.query['hub.mode'] === 'subscribe' && 
        req.query['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      res.send(req.query['hub.challenge']);
    } else {
      res.sendStatus(403);
    }
  });

  // Mock API routes for testing
  app.get('/api/orders', (req, res) => {
    res.json(mockOrders);
  });

  app.get('/api/agents', (req, res) => {
    res.json(mockAgents);
  });

  app.get('/api/fraud-alerts', (req, res) => {
    res.json(mockFraudAlerts);
  });

  app.get('/api/remittance-issues', (req, res) => {
    res.json(mockRemittanceIssues);
  });

  app.post('/api/orders/:id/approve', (req, res) => {
    const order = mockOrders.find(o => o.id === req.params.id);
    if (order) {
      order.status = 'CONFIRMED';
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  });

  app.post('/api/orders/:id/reject', (req, res) => {
    const order = mockOrders.find(o => o.id === req.params.id);
    if (order) {
      order.status = 'CANCELLED';
      res.json(order);
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  });

  app.post('/api/deliveries/:id/reassign', (req, res) => {
    res.json({ success: true });
  });

  app.post('/api/agents/:id/availability', (req, res) => {
    const agent = mockAgents.find(a => a.id === req.params.id);
    if (agent) {
      agent.isAvailable = req.body.isAvailable;
      res.json(agent);
    } else {
      res.status(404).json({ error: 'Agent not found' });
    }
  });

  app.post('/api/fraud-alerts/:id/resolve', (req, res) => {
    const alert = mockFraudAlerts.find(a => a.id === req.params.id);
    if (alert) {
      alert.status = req.body.resolution;
      res.json(alert);
    } else {
      res.status(404).json({ error: 'Alert not found' });
    }
  });

  app.post('/api/remittance-issues/:id/resolve', (req, res) => {
    const issue = mockRemittanceIssues.find(i => i.id === req.params.id);
    if (issue) {
      issue.status = req.body.resolution;
      res.json(issue);
    } else {
      res.status(404).json({ error: 'Issue not found' });
    }
  });

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
  });

  // Start server
  const port = config.PORT;
  server.listen(port, () => {
    logger.info(`Server running on port ${port} in ${config.NODE_ENV} mode`);
    logger.info(`Trading bot running in ${config.isDemoMode ? 'demo' : 'live'} mode`);
    logger.info(`AI enabled: ${config.ENABLE_AI}`);
    logger.info(`Notifications enabled: ${config.ENABLE_NOTIFICATIONS}`);
  });

  return { app, server };
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
  process.exit(1);
});

createApp().catch((error) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Starting graceful shutdown...');
  
  try {
    await prisma.$disconnect();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
});