import { Candle } from '../types';
import { ExchangeContract } from './contracts/ExchangeContract';
import { logger } from './Logger';
import { Helpers } from '../utils/Helpers';

interface TickerCache {
  data: any;
  timestamp: number;
}

export class MarketDataManager {
  private exchange: ExchangeContract;
  
  // Cache storage
  private candlesCache: Map<string, Candle[]> = new Map();
  // Buffer for startup synchronization
  private initializationBuffer: Map<string, any[]> = new Map();
  private isInitializing: boolean = false;
  
  // Prevent double refetching
  private refetchingStates: Set<string> = new Set();
  
  private tickerCache: Map<string, TickerCache> = new Map();
  
  private maxCandles = 1000;
  private tickerTtl = 60 * 60 * 1000; // 1 hour TTL

  constructor(exchange: ExchangeContract) {
    this.exchange = exchange;
  }

  /**
   * Initialize Data Flow:
   * 1. Subscribe to WS immediately (buffer data).
   * 2. Fetch REST API history.
   * 3. Merge history + buffered data.
   * 4. Switch to real-time mode.
   */
  public async initialize(symbols: string[], timeframe: string, onCandleClosed: (symbol: string) => void) {
    logger.info('MarketData', '🚀 Starting initialization sequence...');
    
    this.isInitializing = true;
    symbols.forEach(s => this.initializationBuffer.set(s, []));

    // 1. Subscribe First (Start Buffering)
    this.exchange.subscribeToCandles(symbols, timeframe, (streamData) => {
        const symbol = streamData.s;
        
        if (this.isInitializing) {
            // Buffer data while history is loading
            const buffer = this.initializationBuffer.get(symbol);
            if (buffer) buffer.push(streamData);
        } else {
            // Process directly in real-time
            this.handleStreamMessage(streamData, timeframe, onCandleClosed);
        }
    });

    logger.info('MarketData', '📡 WebSocket subscribed. Buffering events...');
    await Helpers.sleep(1000); // Allow WS connection to establish

    // 2. Fetch History (Parallel-ish with delays)
    logger.info('MarketData', '📥 Fetching historical snapshots via REST...');
    
    for (const symbol of symbols) {
      try {
        const history = await this.exchange.getCandles(symbol, timeframe, this.maxCandles);
        
        // 3. Merge Buffer into History
        this.mergeHistoryWithBuffer(symbol, history);
        
        logger.info('MarketData', `✅ ${symbol}: History loaded (${history.length}) + Buffer merged.`);
      } catch (e) {
        logger.error('MarketData', `Failed to load history for ${symbol}`, e);
      }
      await Helpers.sleep(50); // Rate limit protection
    }

    // 4. Switch to Real-Time
    this.isInitializing = false;
    this.initializationBuffer.clear();
    
    logger.info('MarketData', '🟢 Synchronization complete. Real-time mode active.');
  }

  /**
   * Merge historical candles with buffered WS ticks
   * FIXED: Sorting buffer & Dynamic Merge Pointer
   */
  private mergeHistoryWithBuffer(symbol: string, history: Candle[]) {
    // 1. Sort buffer by timestamp to handle out-of-order WS packets
    const buffer = (this.initializationBuffer.get(symbol) || []).sort((a, b) => a.k.t - b.k.t);
    
    if (history.length === 0) {
        this.candlesCache.set(symbol, []);
        return;
    }

    let merged = [...history];

    // 2. Iterate buffer and compare against the *current* last candle in merged array
    for (const streamData of buffer) {
        const k = streamData.k;
        const streamTime = k.t;
        
        // Dynamic check of the last element
        const lastMerged = merged[merged.length - 1];

        // Update if timestamps match (live candle update)
        if (streamTime === lastMerged.timestamp) {
            merged[merged.length - 1] = this.parseStreamCandle(k);
        } 
        // Append if newer (new interval started in buffer)
        else if (streamTime > lastMerged.timestamp) {
             merged.push(this.parseStreamCandle(k));
        }
        // If streamTime < lastMerged.timestamp, ignore (old data)
    }

    // Trim to max size
    if (merged.length > this.maxCandles) {
        merged = merged.slice(-this.maxCandles);
    }

    this.candlesCache.set(symbol, merged);
  }

  private parseStreamCandle(rawKline: any): Candle {
      return {
        timestamp: rawKline.t,
        open: parseFloat(rawKline.o),
        high: parseFloat(rawKline.h),
        low: parseFloat(rawKline.l),
        close: parseFloat(rawKline.c),
        volume: parseFloat(rawKline.v),
        takerBuyBaseVolume: parseFloat(rawKline.V) || 0, // Note uppercase V for taker volume in WS
        openInterest: 0
      };
  }

  public close(): void {
    this.exchange.closeConnection();
    this.candlesCache.clear();
    this.initializationBuffer.clear();
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
   * Handle Stream Message with Gap Detection & Double-Refetch Protection
   */
  private async handleStreamMessage(data: any, timeframe: string, onCandleClosed: (symbol: string) => void) {
    try {
      const rawKline = data.k;
      const symbol = data.s;
      const isClosed = rawKline.x;
      // Use passed timeframe for consistency, not rawKline.i

      const candle = this.parseStreamCandle(rawKline);
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
             
             // Anti-Double Refetch Logic
             if (this.refetchingStates.has(symbol)) {
                 return; // Already fixing gap
             }

             logger.warn('MarketData', `⚠️ GAP detected for ${symbol}! Expected ${expectedNext}, got ${candle.timestamp}. Refetching history...`);
             this.refetchingStates.add(symbol);
             
             // Refetch history to fix the gap
             try {
                // Use the timeframe passed to initialize to stay consistent
                const fixedHistory = await this.exchange.getCandles(symbol, timeframe, this.maxCandles);
                this.candlesCache.set(symbol, fixedHistory);
                
                // If the new candle is closed, trigger the callback now with fixed data
                if (isClosed) {
                    onCandleClosed(symbol);
                }
             } catch (err) {
                 logger.error('MarketData', `Failed to refetch history for gap on ${symbol}`, err);
             } finally {
                 this.refetchingStates.delete(symbol);
             }
             return; // Stop processing this specific tick
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
      const data = await Helpers.retry(() => this.exchange.get24hTicker(symbol), 3, 1000);
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
