import { Candle, ExchangeBalance, ExchangeOrder } from '../../types';

export interface PositionRisk {
  positionAmt: number;
  entryPrice: number;
  unrealizedProfit: number;
}

export interface UserTrade {
  id: string | number;
  orderId: string | number;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  realizedPnl: number;
  commission: number;
  time: number;
  maker: boolean;
}

export interface CandleStreamMessage {
  s: string;
  k: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
    V: string;
    i: string;
    x: boolean;
  };
}

export interface ExchangeContract {
  loadExchangeInfo(): Promise<void>;
  getStepSize(symbol: string): number;
  getPositionRisk(symbol: string): Promise<PositionRisk | null>;
  getCandles(
    symbol: string,
    interval?: string,
    limit?: number,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]>;
  getUserTrades(symbol: string, limit?: number): Promise<UserTrade[]>;
  subscribeToCandles(
    symbols: string[],
    interval: string,
    callback: (data: CandleStreamMessage) => void
  ): void;
  closeConnection(): void;
  getCurrentPrice(symbol: string): Promise<number>;
  get24hTicker(symbol: string): Promise<any>;
  getOpenInterest(symbol: string): Promise<any>;
  getBalance(): Promise<ExchangeBalance[]>;
  getAccountInfo(): Promise<any>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void>;
  placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<ExchangeOrder>;
  placeStopLoss(symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number): Promise<ExchangeOrder>;
  placeTakeProfit(symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number): Promise<ExchangeOrder>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  getOpenOrders(symbol?: string): Promise<ExchangeOrder[]>;
  testConnection(): Promise<boolean>;
}
