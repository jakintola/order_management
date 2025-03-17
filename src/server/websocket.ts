import WebSocket from 'ws';
import { EventEmitter } from 'events';
import logger from './logger.js';
import config from './config.js';
import type { WebSocketMessage } from '../types';

export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isConnecting = false;
  private lastPingTime = 0;

  constructor(
    private readonly url: string,
    private readonly options: {
      maxReconnectAttempts: number;
      reconnectDelay: number;
      pingInterval: number;
    } = {
      maxReconnectAttempts: config.WS_MAX_RECONNECT_ATTEMPTS,
      reconnectDelay: config.WS_RECONNECT_DELAY,
      pingInterval: 15000,
    }
  ) {
    super();
    this.connect();
  }

  private connect(): void {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(this.url, {
        handshakeTimeout: 10000,
        perMessageDeflate: false,
      });

      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
      this.ws.on('pong', this.handlePong.bind(this));

      // Set connection timeout
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.handleError(new Error('Connection timeout'));
        }
      }, 10000);

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private handleOpen(): void {
    logger.info('WebSocket connected successfully');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.setupPing();
    this.emit('open');
  }

  private handleMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString());
      this.emit('message', message);
    } catch (error) {
      logger.warn('Failed to parse WebSocket message', { error });
    }
  }

  private handleError(error: Error): void {
    logger.error('WebSocket error:', { error });
    this.cleanup();
    this.scheduleReconnect();
    this.emit('error', error);
  }

  private handleClose(code: number, reason: string): void {
    logger.info('WebSocket closed', { code, reason });
    this.cleanup();
    this.scheduleReconnect();
    this.emit('close', code, reason);
  }

  private handlePong(): void {
    this.lastPingTime = Date.now();
  }

  private setupPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();

        // Check if we haven't received a pong in a while
        if (Date.now() - this.lastPingTime > this.options.pingInterval * 2) {
          this.handleError(new Error('Ping timeout'));
        }
      }
    }, this.options.pingInterval);
  }

  private cleanup(): void {
    this.isConnecting = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      
      try {
        this.ws.terminate();
      } catch (error) {
        logger.error('Error terminating WebSocket', { error });
      }
      
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts < this.options.maxReconnectAttempts) {
      const delay = Math.min(
        this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempts),
        300000 // Max 5 minutes
      );

      this.reconnectAttempts++;
      
      logger.info('Scheduling reconnection', {
        attempt: this.reconnectAttempts,
        delay: Math.round(delay / 1000) + 's'
      });

      this.reconnectTimeout = setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      logger.error('Max reconnection attempts reached');
      this.emit('max_reconnects');
    }
  }

  public send(message: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Error sending WebSocket message', { error });
        this.handleError(error as Error);
      }
    }
  }

  public close(): void {
    this.cleanup();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}