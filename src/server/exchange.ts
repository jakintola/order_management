import WebSocket from 'ws';
import { config } from './config';
import { logger } from './logger';
import type { ExchangeMessage, PriceData, OHLCVData } from '../types';
import type { Time } from 'lightweight-charts';

interface MockExchange {
  fetchOHLCV: (symbol: string, timeframe: string, since?: number, limit?: number) => Promise<any[]>;
  createOrder: (symbol: string, type: string, side: string, amount: number, price?: number) => Promise<any>;
  fetchBalance: () => Promise<any>;
}

class ExchangeConnector {
  private static instance: ExchangeConnector;
  private exchange: any;
  private ws: WebSocket | null = null;
  private clients: Set<WebSocket> = new Set();
  private reconnectAttempts = 0;
  private isConnecting = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private wsConnectTimeout: NodeJS.Timeout | null = null;
  private lastMessageTime: number = Date.now();
  private realBalances: { [key: string]: number } = {};

  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 5000;
  private readonly heartbeatTimeout = 30000;
  private readonly wsUrl = 'wss://ws.kraken.com';
  private readonly pair = 'BTC/USD';
  private readonly krakenPair = 'XBT/USD';

  private constructor() {
    if (config.DEMO_MODE) {
      logger.info('Running in demo mode - using mock exchange');
      this.exchange = this.createMockExchange();
    } else {
      this.initializeRealExchange();
    }
  }

  private async initializeRealExchange() {
    try {
      const { default: ccxt } = await import('ccxt');
      this.exchange = new ccxt.kraken({
        apiKey: config.EXCHANGE_API_KEY,
        secret: config.EXCHANGE_SECRET,
        enableRateLimit: true,
        timeout: 30000,
        options: {
          adjustForTimeDifference: true,
          recvWindow: 30000,
        }
      });
    } catch (error) {
      logger.error('Failed to initialize real exchange:', error);
      this.exchange = this.createMockExchange();
    }
  }

  private createMockExchange(): MockExchange {
    return {
      fetchOHLCV: async (symbol: string, timeframe: string, since?: number, limit = 100) => {
        return this.generateMockHistoricalData(limit).map(data => [
          data.time * 1000,
          data.open,
          data.high,
          data.low,
          data.close,
          data.volume
        ]);
      },
      createOrder: async (symbol: string, type: string, side: string, amount: number, price?: number) => {
        logger.info(`[DEMO] Would create ${side} ${type} order for ${amount} ${symbol} at ${price || 'market price'}`);
        return {
          id: `demo-${Date.now()}`,
          symbol,
          type,
          side,
          amount,
          price,
          status: 'closed',
          filled: amount,
          remaining: 0,
        };
      },
      fetchBalance: async () => {
        return {
          BTC: { free: 1.5, used: 0.5, total: 2.0 },
          USD: { free: 50000, used: 10000, total: 60000 },
        };
      }
    };
  }

  public static getInstance(): ExchangeConnector {
    if (!ExchangeConnector.instance) {
      ExchangeConnector.instance = new ExchangeConnector();
    }
    return ExchangeConnector.instance;
  }

  public static async initialize(): Promise<void> {
    const instance = ExchangeConnector.getInstance();
    if (!config.DEMO_MODE) {
      await instance.initializeExchange();
    }
    if (!instance.ws) {
      await instance.connectWebSocket();
    }
  }

  private async initializeExchange(): Promise<void> {
    try {
      await this.fetchBalances();
      logger.info('Exchange initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize exchange:', error);
      throw error;
    }
  }

  private async fetchBalances(): Promise<void> {
    try {
      const balance = await this.exchange.fetchBalance();
      this.realBalances = {
        BTC: balance.BTC?.total || 0,
        USD: balance.USD?.total || 0,
      };
    } catch (error) {
      logger.error('Failed to fetch balances:', error);
      if (config.DEMO_MODE) {
        this.realBalances = {
          BTC: 2.0,
          USD: 60000,
        };
      }
    }
  }

  private setupHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      if (now - this.lastMessageTime > this.heartbeatTimeout) {
        logger.warn('Connection idle - attempting refresh');
        this.handleConnectionFailure();
      }
    }, this.heartbeatTimeout);

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 15000);
  }

  private async connectWebSocket(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      if (this.ws) {
        this.ws.removeAllListeners();
        this.ws.terminate();
        this.ws = null;
      }

      if (this.wsConnectTimeout) {
        clearTimeout(this.wsConnectTimeout);
      }

      this.ws = new WebSocket(this.wsUrl);

      this.wsConnectTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          logger.error('WebSocket connection timeout');
          this.handleConnectionFailure();
        }
      }, 30000);

      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
      this.ws.on('pong', () => {
        this.lastMessageTime = Date.now();
      });

    } catch (error) {
      logger.error('Error establishing WebSocket connection:', { error });
      this.isConnecting = false;
      this.handleConnectionFailure();
    }
  }

  private handleOpen(): void {
    if (this.wsConnectTimeout) {
      clearTimeout(this.wsConnectTimeout);
    }
    
    logger.info('WebSocket connected successfully');
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.lastMessageTime = Date.now();

    if (this.ws?.readyState === WebSocket.OPEN) {
      const subscribeMessage = {
        event: 'subscribe',
        pair: [this.krakenPair],
        subscription: {
          name: 'ticker'
        }
      };
      
      this.ws.send(JSON.stringify(subscribeMessage));
    }
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      this.lastMessageTime = Date.now();
      const message = JSON.parse(data.toString());

      if (Array.isArray(message) && message[1] && typeof message[1] === 'object') {
        const [, tickerData] = message;
        if ('c' in tickerData) {
          const [price] = tickerData.c;
          const timestamp = Date.now();
          
          this.broadcastToClients({
            type: 'price',
            data: {
              time: Math.floor(timestamp / 1000) as Time,
              price: parseFloat(price),
              pair: this.pair
            }
          });
        }
      }
    } catch (error) {
      logger.warn('Error parsing message:', { error });
    }
  }

  private handleError(error: Error): void {
    logger.error('WebSocket error:', { error });
    this.handleConnectionFailure();
  }

  private handleClose(code: number, reason: string): void {
    logger.info('WebSocket closed', { code, reason });
    this.isConnecting = false;
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.wsConnectTimeout) {
      clearTimeout(this.wsConnectTimeout);
      this.wsConnectTimeout = null;
    }

    this.handleConnectionFailure();
  }

  private handleConnectionFailure(): void {
    this.isConnecting = false;

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.min(
        this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts),
        300000
      );
      this.reconnectAttempts++;
      setTimeout(() => this.connectWebSocket(), delay);
    } else {
      logger.error('Max reconnection attempts reached');
      this.broadcastToClients({
        type: 'error',
        data: 'Connection to exchange lost. Please refresh the page.'
      });
    }
  }

  public async fetchHistoricalData(
    timeframe = '1m',
    limit = 100
  ): Promise<PriceData[]> {
    try {
      if (config.DEMO_MODE) {
        return this.generateMockHistoricalData(limit);
      }

      const ohlcv = await this.exchange.fetchOHLCV(
        this.krakenPair,
        timeframe,
        undefined,
        limit
      );
      
      return ohlcv.map(([timestamp, open, high, low, close]) => ({
        time: Math.floor(timestamp / 1000) as Time,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
      }));
    } catch (error) {
      logger.error('Error fetching historical data:', { error });
      throw error;
    }
  }

  private generateMockHistoricalData(limit: number): PriceData[] {
    const data: PriceData[] = [];
    let time = Date.now() - (limit * 60 * 1000);
    
    for (let i = 0; i < limit; i++) {
      const basePrice = 50000;
      const variance = Math.random() * 1000 - 500;
      data.push({
        time: Math.floor(time / 1000) as Time,
        open: basePrice + variance,
        high: basePrice + variance + Math.random() * 100,
        low: basePrice + variance - Math.random() * 100,
        close: basePrice + variance + (Math.random() * 200 - 100)
      });
      time += 60 * 1000;
    }
    
    return data;
  }

  public async createOrder(
    type: 'market' | 'limit',
    side: 'buy' | 'sell',
    amount: number,
    price?: number
  ): Promise<ccxt.Order> {
    if (config.DEMO_MODE) {
      throw new Error('Cannot create orders in demo mode');
    }

    try {
      const order = await this.exchange.createOrder(
        this.krakenPair,
        type,
        side,
        amount,
        price
      );
      await this.fetchBalances();
      return order;
    } catch (error) {
      logger.error('Error creating order:', { error });
      throw error;
    }
  }

  private broadcastToClients(message: ExchangeMessage): void {
    const deadClients = new Set<WebSocket>();

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(message));
        } catch (error) {
          logger.error('Error sending data to client:', { error });
          deadClients.add(client);
        }
      } else {
        deadClients.add(client);
      }
    }

    for (const client of deadClients) {
      this.clients.delete(client);
    }
  }

  public static addClient(ws: WebSocket): void {
    const instance = ExchangeConnector.getInstance();
    instance.clients.add(ws);
  }

  public static removeClient(ws: WebSocket): void {
    const instance = ExchangeConnector.getInstance();
    instance.clients.delete(ws);
  }

  public getRealBalances(): { [key: string]: number } {
    return this.realBalances;
  }
}

export const exchangeConnector = ExchangeConnector.getInstance();