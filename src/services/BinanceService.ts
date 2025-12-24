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
  ExchangeBalance,
  OrderFlowData 
} from '../types';
import { config } from '../config/ConfigManager';
import { logger } from './Logger';
import { Helpers } from '../utils/Helpers';

export class BinanceService {
  private apiKey: string;
  private apiSecret: string;
  private baseURL: string;
  private client: AxiosInstance;

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