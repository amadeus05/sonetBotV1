/**
 * Bybit Exchange Service
 * Responsibility: Handle all communication with Bybit API
 * FULLY COMPATIBLE with BinanceService - drop-in replacement
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

export class BybitService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  private client: AxiosInstance;

  // Cache for Step Sizes (e.g. BTCUSDT -> 0.001, 1000PEPEUSDT -> 1)
  private stepSizeCache: Record<string, number> = {};
  private tickSizeCache: Record<string, number> = {};

  private readonly recvWindow = 5000;

  constructor() {
    const botConfig = config.getConfig();
    
    this.apiKey = botConfig.apiKey;
    this.apiSecret = botConfig.apiSecret;
    
    this.baseURL = 'https://api.bybit.com';

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'X-BAPI-API-KEY': this.apiKey
      }
    });

    logger.info('BybitService', `Initialized (https://api.bybit.com)`);
  }

  /**
   * Generate signature for authenticated requests (Bybit format)
   */
  private generateSignature(timestamp: number, params: string): string {
    const message = timestamp + this.apiKey + this.recvWindow + params;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
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
      const response = await this.client.get('/v5/market/instruments-info', {
        params: { category: 'linear' }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      const symbols = response.data.result.list;
      let count = 0;

      for (const symbolData of symbols) {
        const lotSizeFilter = symbolData.lotSizeFilter;
        const priceFilter = symbolData.priceFilter;

        if (lotSizeFilter) {
          this.stepSizeCache[symbolData.symbol] = parseFloat(lotSizeFilter.qtyStep);
        }
        if (priceFilter) {
          this.tickSizeCache[symbolData.symbol] = parseFloat(priceFilter.tickSize);
        }
        count++;
      }

      logger.info('BybitService', `Loaded exchange info for ${count} symbols`);
    } catch (error: any) {
      logger.error('BybitService', 'Failed to load exchange info', error.message);
      throw error;
    }
  }

  /**
   * Get Step Size for a symbol (sync access from cache)
   */
  public getStepSize(symbol: string): number {
    const step = this.stepSizeCache[symbol];
    if (step === undefined) {
      logger.warn('BybitService', `Step size not found for ${symbol}, using default 0.001`);
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
      const params = `category=linear&symbol=${symbol}`;
      const signature = this.generateSignature(timestamp, params);

      const response = await this.client.get('/v5/position/list', {
        params: { 
          category: 'linear',
          symbol: symbol
        },
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      const positions = response.data.result.list;
      const position = positions.find((p: any) => p.symbol === symbol);
      
      if (!position || parseFloat(position.size) === 0) return null;

      return {
        positionAmt: parseFloat(position.size) * (position.side === 'Sell' ? -1 : 1),
        entryPrice: parseFloat(position.avgPrice),
        unrealizedProfit: parseFloat(position.unrealisedPnl)
      };
    } catch (error: any) {
      logger.error('BybitService', `Failed to get position risk for ${symbol}`, error.message);
      return null;
    }
  }

  /**
   * Get historical candles (Bybit format -> Binance format)
   */
  public async getCandles(
    symbol: string,
    interval: string = '5m',
    limit: number = 1000,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    try {
      // Bybit intervals: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
      const bybitInterval = interval.replace('m', '');
      
      const params: any = { 
        category: 'linear',
        symbol, 
        interval: bybitInterval, 
        limit: Math.min(limit, 1000) 
      };
      
      if (startTime) params.start = startTime;
      if (endTime) params.end = endTime;

      const response = await this.client.get('/v5/market/kline', { params });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      // Bybit returns: [timestamp, open, high, low, close, volume, turnover]
      // We need Binance format
      return response.data.result.list.map((kline: any[]) => {
        const volume = parseFloat(kline[5]);
        const turnover = parseFloat(kline[6]);
        
        return {
          timestamp: parseInt(kline[0]),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: volume,
          takerBuyBaseVolume: volume * 0.5, // Bybit doesn't provide this, estimate 50%
          openInterest: 0 // Will be filled separately
        };
      }).reverse(); // Bybit returns newest first, we need oldest first
    } catch (error: any) {
      logger.error('BybitService', `Failed to fetch candles for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Get Historical Open Interest
   * Bybit provides this data via /v5/market/open-interest endpoint
   */
  public async getHistoricalOpenInterest(
    symbol: string,
    period: string,
    limit: number = 500,
    startTime?: number,
    endTime?: number
  ): Promise<{ symbol: string; sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }[]> {
    try {
      // Bybit intervals: 5min, 15min, 30min, 1h, 4h, 1d
      const intervalMap: Record<string, string> = {
        '5m': '5min',
        '15m': '15min',
        '30m': '30min',
        '1h': '1h',
        '4h': '4h',
        '1d': '1d'
      };
      
      const bybitInterval = intervalMap[period] || '5min';
      
      const params: any = { 
        category: 'linear',
        symbol, 
        intervalTime: bybitInterval,
        limit: Math.min(limit, 200)
      };
      
      if (startTime) params.startTime = startTime;
      if (endTime) params.endTime = endTime;

      const response = await this.client.get('/v5/market/open-interest', { params });

      if (response.data.retCode !== 0) {
        logger.warn('BybitService', `Bybit OI API error: ${response.data.retMsg}`);
        return [];
      }

      // Bybit format: { openInterest: string, timestamp: string }
      // Convert to Binance format
      return response.data.result.list.map((item: any) => ({
        symbol: symbol,
        sumOpenInterest: item.openInterest,
        sumOpenInterestValue: item.openInterest, // Bybit doesn't separate these
        timestamp: parseInt(item.timestamp)
      })).reverse(); // Bybit returns newest first
    } catch (error: any) {
      logger.warn('BybitService', `Failed to fetch OI history for ${symbol}`, error.message);
      return [];
    }
  }

  /**
   * Get current price
   */
  public async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const response = await this.client.get('/v5/market/tickers', {
        params: { 
          category: 'linear',
          symbol 
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      return parseFloat(response.data.result.list[0].lastPrice);
    } catch (error: any) {
      logger.error('BybitService', `Failed to fetch price for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Get 24h ticker data
   */
  public async get24hTicker(symbol: string): Promise<any> {
    try {
      const response = await this.client.get('/v5/market/tickers', {
        params: { 
          category: 'linear',
          symbol 
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      const ticker = response.data.result.list[0];
      
      // Convert Bybit format to Binance-like format
      return {
        symbol: ticker.symbol,
        lastPrice: ticker.lastPrice,
        volume: ticker.volume24h,
        priceChangePercent: ticker.price24hPcnt,
        highPrice: ticker.highPrice24h,
        lowPrice: ticker.lowPrice24h,
        openPrice: ticker.prevPrice24h
      };
    } catch (error: any) {
      logger.error('BybitService', `Failed to fetch 24h ticker for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Get Open Interest data
   */
  public async getOpenInterest(symbol: string): Promise<any> {
    try {
      const response = await this.client.get('/v5/market/open-interest', {
        params: { 
          category: 'linear',
          symbol,
          intervalTime: '5min',
          limit: 1
        }
      });

      if (response.data.retCode !== 0) {
        logger.warn('BybitService', `Failed to fetch OI for ${symbol}`);
        return null;
      }

      const latest = response.data.result.list[0];
      return {
        symbol: symbol,
        openInterest: latest.openInterest,
        timestamp: latest.timestamp
      };
    } catch (error: any) {
      logger.warn('BybitService', `Failed to fetch OI for ${symbol}`, error.message);
      return null;
    }
  }

  /**
   * Get account balance
   */
  public async getBalance(): Promise<ExchangeBalance[]> {
    try {
      const timestamp = Date.now();
      const params = 'accountType=UNIFIED';
      const signature = this.generateSignature(timestamp, params);

      const response = await this.client.get('/v5/account/wallet-balance', {
        params: { accountType: 'UNIFIED' },
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      const coins = response.data.result.list[0].coin;
      
      return coins.map((coin: any) => ({
        asset: coin.coin,
        free: parseFloat(coin.availableToWithdraw),
        locked: parseFloat(coin.locked),
        total: parseFloat(coin.walletBalance)
      }));
    } catch (error: any) {
      logger.error('BybitService', 'Failed to fetch balance', error.message);
      throw error;
    }
  }

  /**
   * Get account information
   */
  public async getAccountInfo(): Promise<any> {
    try {
      const timestamp = Date.now();
      const params = 'accountType=UNIFIED';
      const signature = this.generateSignature(timestamp, params);

      const response = await this.client.get('/v5/account/wallet-balance', {
        params: { accountType: 'UNIFIED' },
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      return response.data.result;
    } catch (error: any) {
      logger.error('BybitService', 'Failed to fetch account info', error.message);
      throw error;
    }
  }

  /**
   * Set leverage for symbol
   */
  public async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      const timestamp = Date.now();
      const params = `category=linear&symbol=${symbol}&buyLeverage=${leverage}&sellLeverage=${leverage}`;
      const signature = this.generateSignature(timestamp, params);

      await this.client.post('/v5/position/set-leverage', {
        category: 'linear',
        symbol,
        buyLeverage: leverage.toString(),
        sellLeverage: leverage.toString()
      }, {
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      logger.info('BybitService', `Set leverage to ${leverage}x for ${symbol}`);
    } catch (error: any) {
      logger.error('BybitService', `Failed to set leverage for ${symbol}`, error.message);
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
      const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';
      const timestamp = Date.now();
      
      const orderData = {
        category: 'linear',
        symbol,
        side: bybitSide,
        orderType: 'Market',
        qty: q.toString()
      };
      
      const params = `category=linear&symbol=${symbol}&side=${bybitSide}&orderType=Market&qty=${q}`;
      const signature = this.generateSignature(timestamp, params);

      const response = await this.client.post('/v5/order/create', orderData, {
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      logger.trade(symbol, `${side} MARKET order placed`, {
        quantity: q,
        orderId: response.data.result.orderId
      });

      return {
        orderId: response.data.result.orderId,
        symbol: symbol,
        side,
        type: 'MARKET',
        quantity: q,
        price: 0, // Market orders don't have a preset price
        status: 'NEW',
        timestamp: Date.now()
      };
    } catch (error: any) {
      logger.error('BybitService', `Failed to place ${side} order for ${symbol}`, error.message);
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
      const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';
      const timestamp = Date.now();
      
      const orderData = {
        category: 'linear',
        symbol,
        side: bybitSide,
        orderType: 'Market',
        qty: q.toString(),
        triggerPrice: p.toString(),
        triggerBy: 'LastPrice',
        reduceOnly: true
      };
      
      const params = `category=linear&symbol=${symbol}&side=${bybitSide}&orderType=Market&qty=${q}&triggerPrice=${p}&reduceOnly=true`;
      const signature = this.generateSignature(timestamp, params);

      const response = await this.client.post('/v5/order/create', orderData, {
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      logger.trade(symbol, `STOP LOSS order placed at ${p}`, { quantity: q });

      return {
        orderId: response.data.result.orderId,
        symbol: symbol,
        side,
        type: 'STOP_LOSS',
        quantity: q,
        stopPrice: p,
        status: 'NEW',
        timestamp: Date.now()
      };
    } catch (error: any) {
      logger.error('BybitService', `Failed to place stop loss for ${symbol}`, error.message);
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
      const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';
      const timestamp = Date.now();
      
      const orderData = {
        category: 'linear',
        symbol,
        side: bybitSide,
        orderType: 'Market',
        qty: q.toString(),
        triggerPrice: p.toString(),
        triggerBy: 'LastPrice',
        reduceOnly: true
      };
      
      const params = `category=linear&symbol=${symbol}&side=${bybitSide}&orderType=Market&qty=${q}&triggerPrice=${p}&reduceOnly=true`;
      const signature = this.generateSignature(timestamp, params);

      const response = await this.client.post('/v5/order/create', orderData, {
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      logger.trade(symbol, `TAKE PROFIT order placed at ${p}`, { quantity: q });

      return {
        orderId: response.data.result.orderId,
        symbol: symbol,
        side,
        type: 'TAKE_PROFIT',
        quantity: q,
        price: p,
        status: 'NEW',
        timestamp: Date.now()
      };
    } catch (error: any) {
      logger.error('BybitService', `Failed to place take profit for ${symbol}`, error.message);
      throw error;
    }
  }

  /**
   * Cancel order
   */
  public async cancelOrder(symbol: string, orderId: string): Promise<void> {
    try {
      const timestamp = Date.now();
      const params = `category=linear&symbol=${symbol}&orderId=${orderId}`;
      const signature = this.generateSignature(timestamp, params);

      await this.client.post('/v5/order/cancel', {
        category: 'linear',
        symbol,
        orderId
      }, {
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      logger.trade(symbol, `Order ${orderId} cancelled`);
    } catch (error: any) {
      logger.error('BybitService', `Failed to cancel order ${orderId}`, error.message);
      throw error;
    }
  }

  /**
   * Get all open orders
   */
  public async getOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
    try {
      const timestamp = Date.now();
      let params = 'category=linear';
      if (symbol) params += `&symbol=${symbol}`;
      
      const signature = this.generateSignature(timestamp, params);

      const requestParams: any = { category: 'linear' };
      if (symbol) requestParams.symbol = symbol;

      const response = await this.client.get('/v5/order/realtime', {
        params: requestParams,
        headers: {
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': this.recvWindow,
          'X-BAPI-SIGN': signature
        }
      });

      if (response.data.retCode !== 0) {
        throw new Error(`Bybit API error: ${response.data.retMsg}`);
      }

      return response.data.result.list.map((order: any) => ({
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side === 'Buy' ? 'BUY' : 'SELL',
        type: order.orderType,
        quantity: parseFloat(order.qty),
        price: parseFloat(order.price),
        stopPrice: parseFloat(order.triggerPrice || '0'),
        status: order.orderStatus,
        timestamp: parseInt(order.updatedTime)
      }));
    } catch (error: any) {
      logger.error('BybitService', 'Failed to fetch open orders', error.message);
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
      const response = await this.client.get('/v5/market/time');
      if (response.data.retCode === 0) {
        logger.info('BybitService', 'Connection test successful');
        return true;
      }
      logger.error('BybitService', 'Connection test failed');
      return false;
    } catch (error) {
      logger.error('BybitService', 'Connection test failed');
      return false;
    }
  }
}