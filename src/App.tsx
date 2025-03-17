import { useState, useEffect } from 'react';
import { TradingChart } from './components/TradingChart';
import { ApiSettings } from './components/ApiSettings';
import { Activity, TrendingUp, DollarSign, AlertCircle, Brain, Wallet } from 'lucide-react';
import { tradingBot } from './utils/trading';
import type { PriceData, Trade, Position } from './types';
import { format } from 'date-fns';
import type { Time } from 'lightweight-charts';

function App() {
  const [priceData, setPriceData] = useState<PriceData[]>([]);
  const [botState, setBotState] = useState<{
    balance: { demo: number; real: { [key: string]: number } };
    positions: Position[];
    trades: Trade[];
    predictions: number[];
    activeAccount: 'demo' | 'real';
  }>({
    balance: { demo: 10000, real: {} },
    positions: [],
    trades: [],
    predictions: [],
    activeAccount: 'demo'
  });

  useEffect(() => {
    const generateInitialData = () => {
      const data: PriceData[] = [];
      let time = Date.now() - 24 * 60 * 60 * 1000;
      
      for (let i = 0; i < 100; i++) {
        const basePrice = 50000;
        const variance = Math.random() * 1000 - 500;
        const open = basePrice + variance;
        const close = open + Math.random() * 200 - 100;
        const high = Math.max(open, close) + Math.random() * 100;
        const low = Math.min(open, close) - Math.random() * 100;
        
        data.push({
          time: Math.floor(time / 1000) as Time,
          open,
          high,
          low,
          close,
        });
        time += 15 * 60 * 1000;
      }
      return data;
    };

    setPriceData(generateInitialData());

    const interval = setInterval(() => {
      setBotState(tradingBot.getState());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const toggleAccount = () => {
    const newAccountType = botState.activeAccount === 'demo' ? 'real' : 'demo';
    tradingBot.setActiveAccount(newAccountType);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Crypto Trading Bot Dashboard</h1>
            <p className="text-gray-600">AI-powered monitoring and automated trading</p>
          </div>
          <div className="flex items-center space-x-4">
            <ApiSettings isReal={botState.activeAccount === 'real'} />
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium text-gray-600">Account Type:</span>
              <button
                onClick={toggleAccount}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  botState.activeAccount === 'demo'
                    ? 'bg-blue-500 text-white'
                    : 'bg-green-500 text-white'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <Wallet className="w-4 h-4" />
                  <span>{botState.activeAccount === 'demo' ? 'Demo Account' : 'Real Account'}</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-2">
              <DollarSign className="w-5 h-5 text-blue-500 mr-2" />
              <h2 className="text-lg font-semibold">Balance</h2>
            </div>
            <p className="text-2xl font-bold">
              {botState.activeAccount === 'demo' 
                ? `$${botState.balance.demo.toFixed(2)}`
                : Object.entries(botState.balance.real)
                    .map(([currency, amount]) => `${amount.toFixed(2)} ${currency}`)
                    .join(', ')}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-2">
              <Activity className="w-5 h-5 text-green-500 mr-2" />
              <h2 className="text-lg font-semibold">Active Positions</h2>
            </div>
            <p className="text-2xl font-bold">{botState.positions.length}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-2">
              <TrendingUp className="w-5 h-5 text-purple-500 mr-2" />
              <h2 className="text-lg font-semibold">Total Trades</h2>
            </div>
            <p className="text-2xl font-bold">{botState.trades.length}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-2">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
              <h2 className="text-lg font-semibold">Risk Level</h2>
            </div>
            <p className="text-2xl font-bold">Medium</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-2">
              <Brain className="w-5 h-5 text-indigo-500 mr-2" />
              <h2 className="text-lg font-semibold">AI Prediction</h2>
            </div>
            <p className="text-2xl font-bold">
              {botState.predictions.length > 0
                ? `$${botState.predictions[0].toFixed(2)}`
                : 'Training...'}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Price Chart</h2>
          <TradingChart data={priceData} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Recent Trades</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Price</th>
                    <th className="text-left py-2">Amount</th>
                    <th className="text-left py-2">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {botState.trades.slice(-5).reverse().map((trade) => (
                    <tr key={trade.id} className="border-b">
                      <td className={`py-2 ${trade.type === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                        {trade.type.toUpperCase()}
                      </td>
                      <td className="py-2">${trade.price.toFixed(2)}</td>
                      <td className="py-2">{trade.amount} BTC</td>
                      <td className="py-2">{format(trade.timestamp, 'HH:mm:ss')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Current Positions</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Symbol</th>
                    <th className="text-left py-2">Amount</th>
                    <th className="text-left py-2">Avg Price</th>
                    <th className="text-left py-2">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {botState.positions.map((position) => (
                    <tr key={position.symbol} className="border-b">
                      <td className="py-2">{position.symbol}</td>
                      <td className="py-2">{position.amount.toFixed(8)}</td>
                      <td className="py-2">${position.averagePrice.toFixed(2)}</td>
                      <td className={`py-2 ${position.pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ${position.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;