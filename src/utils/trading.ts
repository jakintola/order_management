import { Trade, Position, AccountBalance } from '../types';
import { pricePredictor } from './prediction';
import { ExchangeConnector } from '../server/exchange';

export class TradingBot {
  private positions: Position[] = [];
  private trades: Trade[] = [];
  private balance: AccountBalance = {
    demo: 10000,
    real: {}
  };
  private priceHistory: number[][] = [];
  private predictions: { price: number; confidence: number }[] = [];
  private readonly maxPositions = 3;
  private readonly stopLossPercentage = 0.02;
  private readonly takeProfitPercentage = 0.05;
  private activeAccount: 'demo' | 'real' = 'demo';
  private readonly pair = 'BTC/USDT';

  constructor() {
    this.initializeBot();
  }

  private initializeBot() {
    setInterval(() => this.analyzePrices(), 5000);
  }

  public setActiveAccount(accountType: 'demo' | 'real') {
    this.activeAccount = accountType;
    if (accountType === 'real') {
      this.balance.real = ExchangeConnector.getInstance().getRealBalances();
    }
  }

  private async updatePredictions() {
    if (this.priceHistory.length >= 20) {
      const { predictions, confidence } = await pricePredictor.predict(this.priceHistory.slice(-20));
      this.predictions = predictions.map(price => ({ price, confidence }));
      
      if (this.priceHistory.length >= 50) {
        const { loss, mse } = await pricePredictor.train(this.priceHistory);
        console.log(`Model trained - Loss: ${loss.toFixed(4)}, MSE: ${mse.toFixed(4)}`);
      }
    }
  }

  private checkStopLossAndTakeProfit(currentPrice: number) {
    const accountPositions = this.positions.filter(p => p.accountType === this.activeAccount);
    for (const position of accountPositions) {
      const pnlPercentage = (currentPrice - position.averagePrice) / position.averagePrice;
      
      if (pnlPercentage <= -this.stopLossPercentage) {
        console.log(`Stop loss triggered for ${this.activeAccount} position at ${position.averagePrice}`);
        this.executeSell(currentPrice, position.amount);
      } else if (pnlPercentage >= this.takeProfitPercentage) {
        console.log(`Take profit triggered for ${this.activeAccount} position at ${position.averagePrice}`);
        this.executeSell(currentPrice, position.amount);
      }
    }
  }

  private analyzePrices() {
    const currentPrice = this.getCurrentPrice();
    
    this.priceHistory.push([currentPrice, currentPrice + 100, currentPrice - 100, currentPrice]);
    if (this.priceHistory.length > 100) this.priceHistory.shift();
    
    this.updatePredictions();
    this.checkStopLossAndTakeProfit(currentPrice);
    
    const signal = this.generateSignal(currentPrice);
    if (signal === 'buy') {
      this.executeBuy(currentPrice);
    } else if (signal === 'sell') {
      this.executeSell(currentPrice);
    }
  }

  private getCurrentPrice(): number {
    const basePrice = 50000;
    return basePrice + (Math.random() - 0.5) * 1000;
  }

  private generateSignal(currentPrice: number): 'buy' | 'sell' | null {
    if (this.predictions.length === 0) return null;
    
    const shortTermPrediction = this.predictions[0];
    const longTermPrediction = this.predictions[this.predictions.length - 1];
    
    if (shortTermPrediction.confidence < 0.7) return null;
    
    const accountPositions = this.positions.filter(p => p.accountType === this.activeAccount);
    if (accountPositions.length >= this.maxPositions) return null;
    
    const priceChange = (shortTermPrediction.price - currentPrice) / currentPrice;
    const longTermTrend = (longTermPrediction.price - currentPrice) / currentPrice;
    
    if (priceChange > 0.02 && longTermTrend > 0) {
      return 'buy';
    } else if (priceChange < -0.02 && longTermTrend < 0) {
      return 'sell';
    }
    
    return null;
  }

  private async executeBuy(price: number, customAmount?: number) {
    const amount = customAmount || 0.1;
    const cost = amount * price;
    
    if (this.activeAccount === 'demo') {
      if (this.balance.demo >= cost) {
        const trade: Trade = {
          id: Math.random().toString(36).substr(2, 9),
          type: 'buy',
          price,
          amount,
          timestamp: Date.now(),
          accountType: this.activeAccount
        };
        
        this.trades.push(trade);
        this.balance.demo -= cost;
        this.updatePositions(trade);
      }
    } else {
      try {
        const order = await ExchangeConnector.getInstance().createOrder('market', 'buy', amount);
        const trade: Trade = {
          id: order.id,
          type: 'buy',
          price: order.price,
          amount: order.amount,
          timestamp: Date.now(),
          accountType: 'real'
        };
        this.trades.push(trade);
        this.balance.real = ExchangeConnector.getInstance().getRealBalances();
        this.updatePositions(trade);
      } catch (error) {
        console.error('Failed to execute buy order:', error);
      }
    }
  }

  private async executeSell(price: number, customAmount?: number) {
    const position = this.positions.find(p => p.symbol === this.pair && p.accountType === this.activeAccount);
    if (!position || position.amount <= 0) return;

    const amount = customAmount || Math.min(0.1, position.amount);

    if (this.activeAccount === 'demo') {
      const trade: Trade = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'sell',
        price,
        amount,
        timestamp: Date.now(),
        accountType: 'demo'
      };
      
      this.trades.push(trade);
      this.balance.demo += amount * price;
      this.updatePositions(trade);
    } else {
      try {
        const order = await ExchangeConnector.getInstance().createOrder('market', 'sell', amount);
        const trade: Trade = {
          id: order.id,
          type: 'sell',
          price: order.price,
          amount: order.amount,
          timestamp: Date.now(),
          accountType: 'real'
        };
        this.trades.push(trade);
        this.balance.real = ExchangeConnector.getInstance().getRealBalances();
        this.updatePositions(trade);
      } catch (error) {
        console.error('Failed to execute sell order:', error);
      }
    }
  }

  private updatePositions(trade: Trade) {
    const position = this.positions.find(p => p.symbol === this.pair && p.accountType === trade.accountType);
    
    if (!position && trade.type === 'buy') {
      this.positions.push({
        symbol: this.pair,
        amount: trade.amount,
        averagePrice: trade.price,
        currentPrice: trade.price,
        pnl: 0,
        accountType: trade.accountType
      });
    } else if (position) {
      if (trade.type === 'buy') {
        position.amount += trade.amount;
        position.averagePrice = (position.averagePrice * position.amount + trade.price * trade.amount) / (position.amount + trade.amount);
      } else {
        position.amount -= trade.amount;
        if (position.amount <= 0) {
          this.positions = this.positions.filter(p => p.symbol !== this.pair || p.accountType !== trade.accountType);
        }
      }
      position.currentPrice = trade.price;
      position.pnl = (position.currentPrice - position.averagePrice) * position.amount;
    }
  }

  public getState() {
    return {
      balance: this.balance,
      positions: this.positions.filter(p => p.accountType === this.activeAccount),
      trades: this.trades.filter(t => t.accountType === this.activeAccount),
      predictions: this.predictions.map(p => p.price),
      activeAccount: this.activeAccount
    };
  }
}

export const tradingBot = new TradingBot();