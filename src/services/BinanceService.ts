/**
 * Binance Exchange Service
 * Responsibility: Handle all communication with Binance API
 * PATCHED: quantity/price normalization, reduceOnly, recvWindow, safer positionRisk, WebSocket Support
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

export class BinanceService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  private wsBaseURL: string;
  private client: AxiosInstance;
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  // Cache for Step Sizes (e.g. BTCUSDT -> 0.001, 1000PEPEUSDT -> 1)
  private stepSizeCache: Record<string, number> = {};
  private tickSizeCache: Record<string, number> = {};

  private readonly recvWindow = 5000;

  constructor() {
    const botConfig = config.getConfig();

    this.apiKey = botConfig.apiKey;
    this.apiSecret = botConfig.apiSecret;

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
   * Get specific position risk (size, margin, etc.)
   * Used to verify if position is still open on exchange
   */
  public async getPositionRisk(symbol: string): Promise<{ positionAmt: number; entryPrice: number; unrealizedProfit: number } | null> {
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
   * Note: Limit max is usually 500 for this endpoint
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
        // Handle combined stream payload structure: { stream: "...", data: {...} }
        if (parsed.data && parsed.data.e === 'kline') {
          callback(parsed.data);
        }
        // Handle single stream payload
        else if (parsed.e === 'kline') {
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
   * Place market order
   */
  public async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<ExchangeOrder> {
    try {
      const q = this.normalizeQuantity(symbol, quantity);
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
    try {
      const q = this.normalizeQuantity(symbol, quantity);
      const p = this.normalizePrice(symbol, stopPrice);
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=STOP_MARKET&quantity=${q}&stopPrice=${p}&reduceOnly=true&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: { symbol, side, type: 'STOP_MARKET', quantity: q, stopPrice: p, reduceOnly: true, timestamp, recvWindow: this.recvWindow, signature }
      });

      logger.trade(symbol, `STOP LOSS order placed at ${p}`, { quantity: q });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'STOP_LOSS',
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
    try {
      const q = this.normalizeQuantity(symbol, quantity);
      const p = this.normalizePrice(symbol, price);
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=TAKE_PROFIT_MARKET&quantity=${q}&stopPrice=${p}&reduceOnly=true&timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: { symbol, side, type: 'TAKE_PROFIT_MARKET', quantity: q, stopPrice: p, reduceOnly: true, timestamp, recvWindow: this.recvWindow, signature }
      });

      logger.trade(symbol, `TAKE PROFIT order placed at ${p}`, { quantity: q });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'TAKE_PROFIT',
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