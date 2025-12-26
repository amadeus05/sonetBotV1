import { Candle } from '../types';
import { BinanceService } from './BinanceService';
import { logger } from './Logger';
import { Helpers } from '../utils/Helpers';

interface TickerCache {
  data: any;
  timestamp: number;
}

export class MarketDataManager {
  private binance: BinanceService;
  
  // Cache storage
  private candlesCache: Map<string, Candle[]> = new Map();
  private tickerCache: Map<string, TickerCache> = new Map();
  
  private maxCandles = 1000;
  private tickerTtl = 60 * 60 * 1000; // 1 hour TTL

  constructor(binance: BinanceService) {
    this.binance = binance;
  }

  public async initialize(symbols: string[], timeframe: string, onCandleClosed: (symbol: string) => void) {
    logger.info('MarketData', '📥 Fetching historical snapshots...');
    
    // Sequential load to avoid rate limits at startup
    for (const symbol of symbols) {
      try {
        const history = await this.binance.getCandles(symbol, timeframe, this.maxCandles);
        this.candlesCache.set(symbol, history);
        await Helpers.sleep(100); 
      } catch (e) {
        logger.error('MarketData', `Failed to load history for ${symbol}`, e);
      }
    }
    logger.info('MarketData', 'Snapshot loaded. Starting WebSocket...');

    this.binance.subscribeToCandles(symbols, timeframe, (streamData) => {
      this.handleStreamMessage(streamData, timeframe, onCandleClosed);
    });
  }

  private getTimeframeMs(timeframe: string): number {
    const map: Record<string, number> = {
        '1m': 60000,
        '3m': 180000,
        '5m': 300000,
        '15m': 900000,
        '30m': 1800000,
        '1h': 3600000,
        '4h': 14400000,
        '1d': 86400000
    };
    return map[timeframe] || 300000;
  }

  /**
   * FIX 5: Handle Stream Message with GAP DETECTION
   */
  private async handleStreamMessage(data: any, timeframe: string, onCandleClosed: (symbol: string) => void) {
    try {
      const rawKline = data.k;
      const symbol = data.s;
      const isClosed = rawKline.x;
      const interval = rawKline.i;

      const candle: Candle = {
        timestamp: rawKline.t,
        open: parseFloat(rawKline.o),
        high: parseFloat(rawKline.h),
        low: parseFloat(rawKline.l),
        close: parseFloat(rawKline.c),
        volume: parseFloat(rawKline.v)
      };

      const currentHistory = this.candlesCache.get(symbol) || [];

      if (currentHistory.length > 0) {
        const lastCandle = currentHistory[currentHistory.length - 1];

        if (candle.timestamp === lastCandle.timestamp) {
          // Update current candle (live)
          currentHistory[currentHistory.length - 1] = candle;
        } else if (candle.timestamp > lastCandle.timestamp) {
          // New Candle -> Check for GAPS
          const expectedNext = lastCandle.timestamp + this.getTimeframeMs(timeframe);
          
          if (candle.timestamp > expectedNext) {
             logger.warn('MarketData', `⚠️ GAP detected for ${symbol}! Missing data between ${lastCandle.timestamp} and ${candle.timestamp}. Refetching history...`);
             
             // Refetch history to fix the gap
             try {
                const fixedHistory = await this.binance.getCandles(symbol, interval, this.maxCandles);
                this.candlesCache.set(symbol, fixedHistory);
                
                // If the new candle is closed, trigger the callback now with fixed data
                if (isClosed) {
                    onCandleClosed(symbol);
                }
                return; // Skip appending the single stream candle since we refetched
             } catch (err) {
                 logger.error('MarketData', `Failed to refetch history for gap on ${symbol}`, err);
             }
          }

          currentHistory.push(candle);
          if (currentHistory.length > this.maxCandles) {
            currentHistory.shift();
          }
        }
      } else {
        currentHistory.push(candle);
      }

      this.candlesCache.set(symbol, currentHistory);

      if (isClosed) {
        onCandleClosed(symbol);
      }
    } catch (error) {
      // ignore
    }
  }

  public async get24hTicker(symbol: string): Promise<any> {
    const now = Date.now();
    const cached = this.tickerCache.get(symbol);

    if (cached && (now - cached.timestamp < this.tickerTtl)) {
      return cached.data;
    }

    try {
      const data = await Helpers.retry(() => this.binance.get24hTicker(symbol), 3, 1000);
      this.tickerCache.set(symbol, {
        data: data,
        timestamp: now
      });
      return data;
    } catch (error: any) {
      if (cached) {
        logger.warn('MarketData', `Network error for ${symbol} ticker, using cached data`);
        return cached.data; 
      }
      return { volume: '999999999', priceChangePercent: '0', lastPrice: '0' }; 
    }
  }

  public getCandles(symbol: string): Candle[] {
    return this.candlesCache.get(symbol) || [];
  }
  
  public getLastPrice(symbol: string): number {
    const candles = this.candlesCache.get(symbol);
    if (!candles || candles.length === 0) return 0;
    return candles[candles.length - 1].close;
  }
}