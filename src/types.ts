import type { Time } from 'lightweight-charts';

export interface Trade {
  id: string;
  type: 'buy' | 'sell';
  price: number;
  amount: number;
  timestamp: number;
  accountType: 'demo' | 'real';
}

export interface Position {
  symbol: string;
  amount: number;
  averagePrice: number;
  currentPrice: number;
  pnl: number;
  accountType: 'demo' | 'real';
}

export interface PriceData {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AccountBalance {
  demo: number;
  real: { [key: string]: number };
}

export interface ExchangeMessage {
  type: 'price' | 'error' | 'connection' | 'balance';
  data: unknown;
}

export interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface WebSocketMessage {
  event?: string;
  pair?: string[];
  subscription?: {
    name: string;
    interval?: number;
  };
}