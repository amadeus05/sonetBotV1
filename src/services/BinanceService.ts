/**
 * Binance Exchange Service
 * Responsibility: Handle all communication with Binance API or Simulate it (Paper Trading)
 * PATCHED: Added Paper Trading logic, WebSocket, getUserTrades
 */

import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import WebSocket from 'ws';
import {
  Candle,
  MarketData,
  ExchangeOrder,
  ExchangeBalance
} from '../types';
import { config } from '../config/ConfigManager';
import { logger } from './Logger';

// === TYPES FOR PAPER TRADING ===
interface PaperPosition {
  symbol: string;
  amt: number;
  entryPrice: number;
  leverage: number;
}

interface PaperOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  origQty: number;
  price: number;
  stopPrice: number;
  status: string;
  time: number;
}

export class BinanceService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  private wsBaseURL: string;
  private client: AxiosInstance;
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  // --- PAPER TRADING STATE ---
  private isPaperTrading: boolean = false;
  private paperState = {
    balance: 1000,
    positions: new Map<string, PaperPosition>(),
    orders: [] as PaperOrder[],
    trades: [] as any[]
  };

  // Cache for Step Sizes (e.g. BTCUSDT -> 0.001, 1000PEPEUSDT -> 1)
  private stepSizeCache: Record<string, number> = {};
  private tickSizeCache: Record<string, number> = {};

  private readonly recvWindow = 5000;

  constructor() {
    const botConfig = config.getConfig();

    this.apiKey = botConfig.apiKey;
    this.apiSecret = botConfig.apiSecret;

    // Detect Paper Trading Mode
    if (!this.apiKey || !this.apiSecret || this.apiKey.trim() === '') {
      this.isPaperTrading = true;
      this.paperState.balance = botConfig.risk.accountBalance || 1000;
      logger.warn('BinanceService', '⚠️ API Keys missing. Switching to PAPER TRADING (SIMULATION) Mode.');
      logger.info('BinanceService', `💰 Paper Balance: $${this.paperState.balance}`);
    }

    if (botConfig.testnet) {
      this.baseURL = 'https://testnet.binancefuture.com';
      this.wsBaseURL = 'wss://stream.binancefuture.com/ws';
    } else {
      this.baseURL = 'https://fapi.binance.com';
      this.wsBaseURL = 'wss://fstream.binance.com/ws';
    }

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'X-MBX-APIKEY': this.apiKey
      }
    });

    // Remove auth header for paper mode
    if (this.isPaperTrading) {
      delete this.client.defaults.headers['X-MBX-APIKEY'];
    }

    logger.info('BinanceService', `Initialized (${this.baseURL})`);
  }

  /**
   * Generate signature for authenticated requests
   */
  private generateSignature(queryString: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Normalize quantity according to symbol step size
   */
  private normalizeQuantity(symbol: string, quantity: number): number {
    const step = this.stepSizeCache[symbol] ?? 0.001;
    return Math.floor(quantity / step) * step;
  }

  /**
   * Normalize price according to symbol tick size
   */
  private normalizePrice(symbol: string, price: number): number {
    const tick = this.tickSizeCache[symbol] ?? 0.01;
    return Math.round(price / tick) * tick;
  }

  /**
   * Load exchange info to cache symbol precisions (Lot Size & Tick Size)
   * MUST be called at bot startup
   */
  public async loadExchangeInfo(): Promise<void> {
    try {
      const response = await this.client.get('/fapi/v1/exchangeInfo');
      const symbols = response.data.symbols;
      let count = 0;

      for (const symbolData of symbols) {
        const lotSize = symbolData.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbolData.filters.find((f: any) => f.filterType === 'PRICE_FILTER');

        if (lotSize) this.stepSizeCache[symbolData.symbol] = parseFloat(lotSize.stepSize);
        if (priceFilter) this.tickSizeCache[symbolData.symbol] = parseFloat(priceFilter.tickSize);
        count++;
      }

      logger.info('BinanceService', `Loaded exchange info for ${count} symbols`);
    } catch (error: any) {
      logger.error('BinanceService', 'Failed to load exchange info', error.message);
      throw error; // Critical failure
    }
  }

  /**
   * Get Step Size for a symbol (sync access from cache)
   */
  public getStepSize(symbol: string): number {
    const step = this.stepSizeCache[symbol];
    if (step === undefined) {
      logger.warn('BinanceService', `Step size not found for ${symbol}, using default 0.001`);
      return 0.001;
    }
    return step;
  }

  /**
   * Helper for Paper Trading Execution
   */
  private async executePaperTrade(symbol: string, side: 'BUY' | 'SELL', qty: number, price: number, reason: string = 'MARKET') {
    const cost = qty * price;
    const fee = cost * 0.0005; // 0.05% taker fee simulation

    let pos = this.paperState.positions.get(symbol);
    const isLong = side === 'BUY';

    // Update Balance (Fee)
    this.paperState.balance -= fee;

    // Log Trade for History
    this.paperState.trades.push({
      id: Date.now(),
      orderId: `paper-${Date.now()}`,
      symbol,
      side,
      price,
      qty,
      realizedPnl: 0,
      time: Date.now(),
      commission: fee,
      maker: false
    });

    logger.info('PAPER', `📝 Executed ${side} ${symbol} @ ${price} (${reason})`);

    if (!pos) {
      // Open new position
      this.paperState.positions.set(symbol, {
        symbol,
        amt: isLong ? qty : -qty,
        entryPrice: price,
        leverage: 1
      });
    } else {
      // Closing or Reversing
      if ((pos.amt > 0 && !isLong) || (pos.amt < 0 && isLong)) {
        // Closing logic
        const pnl = (price - pos.entryPrice) * qty * (pos.amt > 0 ? 1 : -1);
        this.paperState.balance += pnl;

        // Update trade history PnL
        this.paperState.trades[this.paperState.trades.length - 1].realizedPnl = pnl;

        logger.info('PAPER', `💰 PnL Realized: ${pnl.toFixed(2)} USDT. New Balance: ${this.paperState.balance.toFixed(2)}`);

        if (Math.abs(pos.amt) - qty <= 0.0000001) {
          this.paperState.positions.delete(symbol);
          this.paperState.orders = this.paperState.orders.filter(o => o.symbol !== symbol);
        } else {
          pos.amt = pos.amt > 0 ? pos.amt - qty : pos.amt + qty;
        }
      } else {
        // Averaging
        const totalCost = (Math.abs(pos.amt) * pos.entryPrice) + (qty * price);
        const totalQty = Math.abs(pos.amt) + qty;
        pos.entryPrice = totalCost / totalQty;
        pos.amt = isLong ? totalQty : -totalQty;
      }
    }
  }

  /**
   * Get specific position risk (size, margin, etc.)
   * Used to verify if position is still open on exchange
   */
  public async getPositionRisk(symbol: string): Promise<{ positionAmt: number; entryPrice: number; unrealizedProfit: number } | null> {
    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      const pos = this.paperState.positions.get(symbol);
      if (!pos) return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };

      // SIMULATION: Check SL/TP triggers
      const currentPrice = await this.getCurrentPrice(symbol);
      const openOrders = this.paperState.orders.filter(o => o.symbol === symbol && o.status === 'NEW');

      let positionClosed = false;

      for (const order of openOrders) {
        if (order.type === 'STOP_MARKET') {
          const triggered = (pos.amt > 0 && currentPrice <= order.stopPrice) || (pos.amt < 0 && currentPrice >= order.stopPrice);
          if (triggered) {
            await this.executePaperTrade(symbol, order.side, Math.abs(pos.amt), currentPrice, 'STOP_LOSS');
            positionClosed = true;
            break;
          }
        }
        else if (order.type === 'TAKE_PROFIT_MARKET') {
          const triggered = (pos.amt > 0 && currentPrice >= order.stopPrice) || (pos.amt < 0 && currentPrice <= order.stopPrice);
          if (triggered) {
            await this.executePaperTrade(symbol, order.side, Math.abs(pos.amt), currentPrice, 'TAKE_PROFIT');
            positionClosed = true;
            break;
          }
        }
      }

      if (positionClosed) {
        return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
      }

      const sideMultiplier = pos.amt > 0 ? 1 : -1;
      const pnl = (currentPrice - pos.entryPrice) * Math.abs(pos.amt) * sideMultiplier;

      return {
        positionAmt: pos.amt,
        entryPrice: pos.entryPrice,
        unrealizedProfit: pnl
      };
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v2/positionRisk', {
        params: { timestamp, recvWindow: this.recvWindow, signature }
      });

      const data = response.data.find((p: any) => p.symbol === symbol);
      if (!data) return null;

      return {
        positionAmt: parseFloat(data.positionAmt),
        entryPrice: parseFloat(data.entryPrice),
        unrealizedProfit: parseFloat(data.unrealizedProfit)
      };
    } catch (error: any) {
      logger.error('BinanceService', `Failed to get position risk for ${symbol}`, error.message);
      return null;
    }
  }

  /**
   * Get historical candles
   */
  public async getCandles(
    symbol: string,
    interval: string = '5m',
    limit: number = 1000,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    try {
      const params: any = { symbol, interval, limit };

      if (startTime) params.startTime = startTime;
      if (endTime) params.endTime = endTime;

      const response = await this.client.get('/fapi/v1/klines', { params });

      return response.data.map((kline: any[]) => ({
        timestamp: kline[0],
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
        takerBuyBaseVolume: parseFloat(kline[9]),
        openInterest: 0
      }));
    } catch (error: any) {
      logger.error('BinanceService', `Failed to fetch candles for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * NEW: Get Historical Open Interest
   */
  public async getHistoricalOpenInterest(
    symbol: string,
    period: string,
    limit: number = 500,
    startTime?: number,
    endTime?: number
  ): Promise<{ symbol: string; sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }[]> {
    try {
      const params: any = { symbol, period, limit };
      if (startTime) params.startTime = startTime;
      if (endTime) params.endTime = endTime;

      const response = await this.client.get('/futures/data/openInterestHist', { params });
      return response.data;
    } catch (error: any) {
      logger.warn('BinanceService', `Failed to fetch OI history for ${symbol}`, error.message);
      return [];
    }
  }

  /**
   * Get User Trades (needed for TradeExecutor)
   */
  public async getUserTrades(symbol: string, limit: number = 50): Promise<any[]> {
    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      return this.paperState.trades
        .filter(t => t.symbol === symbol)
        .sort((a, b) => b.time - a.time)
        .slice(0, limit);
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v1/userTrades', {
        params: { symbol, limit, timestamp, recvWindow: this.recvWindow, signature }
      });

      return response.data.map((t: any) => ({
        id: t.id,
        orderId: t.orderId,
        symbol: t.symbol,
        side: t.side,
        price: parseFloat(t.price),
        qty: parseFloat(t.qty),
        realizedPnl: parseFloat(t.realizedPnl),
        commission: parseFloat(t.commission),
        time: t.time,
        maker: t.maker
      }));
    } catch (error: any) {
      logger.error('BinanceService', `Failed to fetch user trades for ${symbol}`, error.message);
      return [];
    }
  }

  /**
   * Subscribe to Candle Streams (WebSocket)
   */
  public subscribeToCandles(
    symbols: string[],
    interval: string,
    callback: (data: any) => void
  ): void {
    if (this.ws) {
      this.ws.terminate();
      this.stopPing();
    }

    const streams = symbols.map(s => `${s.toLowerCase()}@kline_${interval}`).join('/');
    const url = `${this.wsBaseURL}/${streams}`;

    logger.info('BinanceService', `🔌 Connecting to WebSocket: ${symbols.length} streams...`);

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info('BinanceService', '✅ WebSocket Connected');
      this.startPing();
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.data && parsed.data.e === 'kline') {
          callback(parsed.data);
        } else if (parsed.e === 'kline') {
          callback(parsed);
        }
      } catch (err) {
        logger.error('BinanceService', 'WS Parse Error', err);
      }
    });

    this.ws.on('error', (err) => {
      logger.error('BinanceService', 'WebSocket Error', err);
    });

    this.ws.on('close', () => {
      logger.warn('BinanceService', '⚠️ WebSocket Closed. Reconnecting in 5s...');
      this.stopPing();
      setTimeout(() => {
        this.subscribeToCandles(symbols, interval, callback);
      }, 5000);
    });
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public closeConnection(): void {
    if (this.ws) {
      logger.info('BinanceService', 'Closing WebSocket connection...');
      this.ws.terminate();
      this.ws = null;
    }
    this.stopPing();
  }

  /**
   * Get current price
   */
  public async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const response = await this.client.get('/fapi/v1/ticker/price', {
        params: { symbol }
      });

      return parseFloat(response.data.price);
    } catch (error: any) {
      logger.error('BinanceService', `Failed to fetch price for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Get 24h ticker data
   */
  public async get24hTicker(symbol: string): Promise<any> {
    try {
      const response = await this.client.get('/fapi/v1/ticker/24hr', {
        params: { symbol }
      });

      return response.data;
    } catch (error: any) {
      logger.error('BinanceService', `Failed to fetch 24h ticker for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Get Open Interest data
   */
  public async getOpenInterest(symbol: string): Promise<any> {
    try {
      const response = await this.client.get('/fapi/v1/openInterest', {
        params: { symbol }
      });

      return response.data;
    } catch (error: any) {
      logger.warn('BinanceService', `Failed to fetch OI for ${symbol}`, error.message);
      return null;
    }
  }

  /**
   * Get account balance
   */
  public async getBalance(): Promise<ExchangeBalance[]> {
    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      return [{
        asset: 'USDT',
        free: this.paperState.balance,
        locked: 0,
        total: this.paperState.balance
      }];
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v2/balance', {
        params: { timestamp, recvWindow: this.recvWindow, signature }
      });

      return response.data.map((balance: any) => ({
        asset: balance.asset,
        free: parseFloat(balance.availableBalance),
        locked: parseFloat(balance.balance) - parseFloat(balance.availableBalance),
        total: parseFloat(balance.balance)
      }));
    } catch (error: any) {
      logger.error('BinanceService', 'Failed to fetch balance', error.message);
      throw error;
    }
  }

  /**
   * Get account information
   */
  public async getAccountInfo(): Promise<any> {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v2/account', {
        params: { timestamp, recvWindow: this.recvWindow, signature }
      });

      return response.data;
    } catch (error: any) {
      logger.error('BinanceService', 'Failed to fetch account info', error.message);
      throw error;
    }
  }

  /**
   * Set leverage for symbol
   */
  public async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (this.isPaperTrading) return;

    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      await this.client.post('/fapi/v1/leverage', null, {
        params: { symbol, leverage, timestamp, recvWindow: this.recvWindow, signature }
      });

      logger.info('BinanceService', `Set leverage to ${leverage}x for ${symbol}`);
    } catch (error: any) {
      logger.error('BinanceService', `Failed to set leverage for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Set margin type for symbol
   */
  public async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    if (this.isPaperTrading) return;

    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&marginType=${marginType}&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      await this.client.post('/fapi/v1/marginType', null, {
        params: { symbol, marginType, timestamp, recvWindow: this.recvWindow, signature }
      });

      logger.info('BinanceService', `Set margin type to ${marginType} for ${symbol}`);
    } catch (error: any) {
      // Ignore error -4046: "No need to change margin type."
      if (error.response?.data?.code === -4046) {
        logger.info('BinanceService', `Margin type already ${marginType} for ${symbol}`);
        return;
      }
      logger.error('BinanceService', `Failed to set margin type for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Place market order
   */
  public async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<ExchangeOrder> {
    const q = this.normalizeQuantity(symbol, quantity);

    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      const price = await this.getCurrentPrice(symbol);
      await this.executePaperTrade(symbol, side, q, price, 'ENTRY');

      return {
        orderId: `paper-${Date.now()}`,
        symbol,
        side,
        type: 'MARKET',
        quantity: q,
        price: price,
        status: 'FILLED',
        timestamp: Date.now()
      };
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${q}&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: { symbol, side, type: 'MARKET', quantity: q, timestamp, recvWindow: this.recvWindow, signature }
      });

      logger.trade(symbol, `${side} MARKET order placed`, {
        quantity: q,
        orderId: response.data.orderId
      });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'MARKET',
        quantity: parseFloat(response.data.executedQty),
        price: parseFloat(response.data.avgPrice || response.data.price),
        status: response.data.status,
        timestamp: response.data.updateTime
      };
    } catch (error: any) {
      logger.error('BinanceService', `Failed to place ${side} order for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Place stop loss order
   */
  public async placeStopLoss(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopPrice: number
  ): Promise<ExchangeOrder> {
    const q = this.normalizeQuantity(symbol, quantity);
    const p = this.normalizePrice(symbol, stopPrice);

    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      const order: PaperOrder = {
        orderId: `paper-sl-${Date.now()}`,
        symbol, side, type: 'STOP_MARKET',
        origQty: q, price: 0, stopPrice: p,
        status: 'NEW', time: Date.now()
      };
      this.paperState.orders.push(order);
      logger.info('PAPER', `🛡️ STOP LOSS placed @ ${p}`);
      return {
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        type: 'STOP_LOSS',
        quantity: q,
        stopPrice: p,
        status: 'NEW',
        timestamp: order.time
      } as any;
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=STOP_MARKET&quantity=${q}&stopPrice=${p}&reduceOnly=true&priceProtect=true&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: {
          symbol, side, type: 'STOP_MARKET', quantity: q,
          stopPrice: p, reduceOnly: true, priceProtect: true,
          timestamp, recvWindow: this.recvWindow, signature
        }
      });

      logger.trade(symbol, `STOP LOSS order placed at ${p}`, { quantity: q });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'STOP_MARKET',
        quantity: q,
        stopPrice: p,
        status: response.data.status,
        timestamp: response.data.updateTime
      };
    } catch (error: any) {
      logger.error('BinanceService', `Failed to place stop loss for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Place take profit order
   */
  public async placeTakeProfit(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number
  ): Promise<ExchangeOrder> {
    const q = this.normalizeQuantity(symbol, quantity);
    const p = this.normalizePrice(symbol, price);

    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      const order: PaperOrder = {
        orderId: `paper-tp-${Date.now()}`,
        symbol, side, type: 'TAKE_PROFIT_MARKET',
        origQty: q, price: 0, stopPrice: p,
        status: 'NEW', time: Date.now()
      };
      this.paperState.orders.push(order);
      logger.info('PAPER', `💎 TAKE PROFIT placed @ ${p}`);
      return {
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        type: 'TAKE_PROFIT',
        quantity: q,
        price: p, // TP usually uses price field in the app
        status: 'NEW',
        timestamp: order.time
      } as any;
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=TAKE_PROFIT_MARKET&quantity=${q}&stopPrice=${p}&reduceOnly=true&priceProtect=true&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: {
          symbol, side, type: 'TAKE_PROFIT_MARKET', quantity: q,
          stopPrice: p, reduceOnly: true, priceProtect: true,
          timestamp, recvWindow: this.recvWindow, signature
        }
      });

      logger.trade(symbol, `TAKE PROFIT order placed at ${p}`, { quantity: q });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'TAKE_PROFIT_MARKET',
        quantity: q,
        price: p,
        status: response.data.status,
        timestamp: response.data.updateTime
      };
    } catch (error: any) {
      logger.error('BinanceService', `Failed to place take profit for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Cancel order
   */
  public async cancelOrder(symbol: string, orderId: string): Promise<void> {
    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      this.paperState.orders = this.paperState.orders.filter(o => o.orderId !== orderId);
      logger.info('PAPER', `Cancelled order ${orderId}`);
      return;
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      await this.client.delete('/fapi/v1/order', {
        params: { symbol, orderId, timestamp, recvWindow: this.recvWindow, signature }
      });

      logger.trade(symbol, `Order ${orderId} cancelled`);
    } catch (error: any) {
      logger.error('BinanceService', `Failed to cancel order ${orderId}`, error.message);
      throw error;
    }
  }

  /**
   * Get all open orders
   */
  public async getOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
    // --- PAPER MODE ---
    if (this.isPaperTrading) {
      const orders = symbol
        ? this.paperState.orders.filter(o => o.symbol === symbol)
        : this.paperState.orders;

      return orders.map(o => ({
        orderId: o.orderId,
        symbol: o.symbol,
        side: o.side as 'BUY' | 'SELL',
        type: 'LIMIT',
        quantity: o.origQty,
        price: o.price,
        stopPrice: o.stopPrice,
        status: 'NEW',
        timestamp: o.time
      }));
    }

    // --- LIVE MODE ---
    try {
      const timestamp = Date.now();
      let queryString = `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      if (symbol) queryString = `symbol=${symbol}&${queryString}`;

      const signature = this.generateSignature(queryString);

      const params: any = { timestamp, recvWindow: this.recvWindow, signature };
      if (symbol) params.symbol = symbol;

      const response = await this.client.get('/fapi/v1/openOrders', { params });

      return response.data.map((order: any) => ({
        orderId: order.orderId.toString(),
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: parseFloat(order.origQty),
        price: parseFloat(order.price),
        stopPrice: parseFloat(order.stopPrice),
        status: order.status,
        timestamp: order.updateTime
      }));
    } catch (error: any) {
      logger.error('BinanceService', 'Failed to fetch open orders', error.message);
      throw error;
    }
  }

  /**
   * Test connectivity
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/fapi/v1/ping');
      logger.info('BinanceService', 'Connection test successful');
      return true;
    } catch (error) {
      logger.error('BinanceService', 'Connection test failed');
      return false;
    }
  }
}