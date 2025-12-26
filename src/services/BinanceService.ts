/**
 * Binance Exchange Service
 * Responsibility: Handle all communication with Binance API
 * Supports both testnet and production
 */

import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { 
  Candle, 
  MarketData, 
  ExchangeOrder, 
  ExchangeBalance
} from '../types';
import { config } from '../config/ConfigManager';
import { logger } from './Logger';
import { Helpers } from '../utils/Helpers';
import WebSocket from 'ws';

export class BinanceService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  private client: AxiosInstance;

  // Cache for Step Sizes (e.g. BTCUSDT -> 0.001, 1000PEPEUSDT -> 1)
  private stepSizeCache: Record<string, number> = {};

  // WebSocket Management
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  constructor() {
    const botConfig = config.getConfig();
    
    this.apiKey = botConfig.apiKey;
    this.apiSecret = botConfig.apiSecret;
    
    // Use testnet or production
    this.baseURL = botConfig.testnet 
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'X-MBX-APIKEY': this.apiKey
      }
    });

    // Handle Rate Limits (429)
    this.client.interceptors.response.use(
      response => response,
      async error => {
        if (error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] || '60', 10);
          logger.warn('BinanceService', `⚠️ API Rate limit hit (429). Sleeping for ${retryAfter}s...`);
          await Helpers.sleep(retryAfter * 1000 + 1000);
          return this.client.request(error.config);
        }
        return Promise.reject(error);
      }
    );

    logger.info('BinanceService', `Initialized (${botConfig.testnet ? 'TESTNET' : 'PRODUCTION'})`);
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
   * Подписка на стрим свечей
   * callback будет вызываться при каждом обновлении свечи
   */
  public subscribeToCandles(symbols: string[], timeframe: string, callback: (data: any) => void): WebSocket {
    // Формируем список стримов
    const streamNames = symbols.map(s => `${s.toLowerCase()}@kline_${timeframe}`).join('/');
    
    // 1. ОПРЕДЕЛЯЕМ ПРАВИЛЬНЫЙ БАЗОВЫЙ URL
    // Для Testnet и Production адреса отличаются кардинально, replace тут ненадежен.
    const isTestnet = this.baseURL.includes('testnet');
    
    let wsBaseUrl = '';
    if (isTestnet) {
        // Официальный адрес WS для Futures Testnet
        wsBaseUrl = 'wss://stream.testnet.binancefuture.com';
    } else {
        // Официальный адрес WS для Futures Production
        wsBaseUrl = 'wss://fstream.binance.com';
    }

    // 2. Собираем полный URL
    const wsUrl = `${wsBaseUrl}/stream?streams=${streamNames}`;

    logger.info('BinanceService', `Connecting to WebSocket: ${wsUrl}`); // Логируем полный URL для проверки
    
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      logger.info('BinanceService', 'WebSocket connected ✅');
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const parsed = JSON.parse(data.toString());
        // Формат: { stream: "...", data: { ... } }
        // Иногда на connection приходит просто ping, его игнорируем, если нет data
        if (parsed.data && parsed.data.e === 'kline') {
          callback(parsed.data);
        }
      } catch (e) {
        // Игнорируем ошибки парсинга (например, служебные сообщения)
      }
    });

    ws.on('error', (err) => {
      logger.error('BinanceService', 'WebSocket error', err.message);
    });

    ws.on('close', (code, reason) => {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        logger.error('BinanceService', 'Max reconnect attempts reached. Stopping bot.');
        process.exit(1);
      }

      const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 60000);
      this.reconnectAttempts++;

      logger.warn('BinanceService', `WebSocket disconnected (Code: ${code}). Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.subscribeToCandles(symbols, timeframe, callback), delay);
    });

    // Пинг-понг для поддержания соединения (опционально, но полезно)
    ws.on('ping', () => {
        ws.pong();
    });

    return ws;
  }

  /**
   * Load exchange info to cache symbol precisions (Lot Size)
   * MUST be called at bot startup
   */
  public async loadExchangeInfo(): Promise<void> {
    try {
      const response = await this.client.get('/fapi/v1/exchangeInfo');
      
      const symbols = response.data.symbols;
      let count = 0;
      
      for (const symbolData of symbols) {
        // Find LOT_SIZE filter to get stepSize
        const lotSizeFilter = symbolData.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        
        if (lotSizeFilter) {
          this.stepSizeCache[symbolData.symbol] = parseFloat(lotSizeFilter.stepSize);
          count++;
        }
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
      const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v2/positionRisk', {
        params: { symbol, timestamp, signature }
      });

      // API returns an array for the specific symbol
      const data = response.data[0] || response.data;
      
      if (!data || typeof data.positionAmt === 'undefined') {
        logger.warn('BinanceService', `Invalid position data for ${symbol}`);
        return null;
      }

      const positionAmt = parseFloat(data.positionAmt);
      const entryPrice = parseFloat(data.entryPrice);

      if (isNaN(positionAmt) || isNaN(entryPrice)) {
        logger.error('BinanceService', `Corrupted position data for ${symbol}`, data);
        return null;
      }
      
      return {
        positionAmt: positionAmt,
        entryPrice: entryPrice,
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
        volume: parseFloat(kline[5])
      }));
    } catch (error: any) {
      logger.error('BinanceService', `Failed to fetch candles for ${symbol}`, error.message);
      throw error;
    }
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
      const queryString = `timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v2/balance', {
        params: { timestamp, signature }
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
      const queryString = `timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v2/account', {
        params: { timestamp, signature }
      });

      return response.data;
    } catch (error: any) {
      logger.error('BinanceService', 'Failed to fetch account info', error.message);
      throw error;
    }
  }

  public async getUserTrades(symbol: string, limit: number = 5): Promise<any[]> {
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.get('/fapi/v1/userTrades', {
        params: { symbol, limit, timestamp, signature }
      });

      if (!Array.isArray(response.data)) {
        logger.warn('BinanceService', `Invalid user trades response for ${symbol}`);
        return [];
      }

      return response.data
        .map((t: any) => ({
          id: t.id,
          orderId: t.orderId,
          price: parseFloat(t.price),
          qty: parseFloat(t.qty),
          realizedPnl: parseFloat(t.realizedPnl),
          side: t.side,
          time: t.time
        }))
        .filter(t => !isNaN(t.price) && !isNaN(t.qty));

    } catch (error: any) {
      logger.error('BinanceService', `Failed to fetch user trades for ${symbol}`, error.message);
      return [];
    }
  }

  /**
   * Set leverage for symbol
   */
  public async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&leverage=${leverage}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      await this.client.post('/fapi/v1/leverage', null, {
        params: { symbol, leverage, timestamp, signature }
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
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: {
          symbol,
          side,
          type: 'MARKET',
          quantity,
          timestamp,
          signature
        }
      });

      logger.trade(symbol, `${side} MARKET order placed`, {
        quantity,
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
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=STOP_MARKET&quantity=${quantity}&stopPrice=${stopPrice}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: {
          symbol,
          side,
          type: 'STOP_MARKET',
          quantity,
          stopPrice,
          timestamp,
          signature
        }
      });

      logger.trade(symbol, `STOP LOSS order placed at ${stopPrice}`, { quantity });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'STOP_LOSS',
        quantity,
        stopPrice,
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
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&side=${side}&type=TAKE_PROFIT_MARKET&quantity=${quantity}&stopPrice=${price}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await this.client.post('/fapi/v1/order', null, {
        params: {
          symbol,
          side,
          type: 'TAKE_PROFIT_MARKET',
          quantity,
          stopPrice: price,
          timestamp,
          signature
        }
      });

      logger.trade(symbol, `TAKE PROFIT order placed at ${price}`, { quantity });

      return {
        orderId: response.data.orderId.toString(),
        symbol: response.data.symbol,
        side,
        type: 'TAKE_PROFIT',
        quantity,
        price,
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
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      await this.client.delete('/fapi/v1/order', {
        params: { symbol, orderId, timestamp, signature }
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
      let queryString = `timestamp=${timestamp}`;
      if (symbol) queryString = `symbol=${symbol}&${queryString}`;
      
      const signature = this.generateSignature(queryString);

      const params: any = { timestamp, signature };
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
   * Get complete market data for analysis
   */
  public async getMarketData(symbol: string): Promise<MarketData> {
    const [candles, ticker] = await Promise.all([
      this.getCandles(symbol),
      this.get24hTicker(symbol)
    ]);

    return {
      symbol,
      candles,
      lastPrice: parseFloat(ticker.lastPrice),
      volume24h: parseFloat(ticker.volume),
      priceChange24h: parseFloat(ticker.priceChangePercent)
    };
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