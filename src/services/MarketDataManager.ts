import { Candle } from '../types';
import { BinanceService } from './BinanceService';
import { logger } from './Logger';

export class MarketDataManager {
  private binance: BinanceService;
  // Хранилище свечей в памяти: Symbol -> Array of Candles
  private candlesCache: Map<string, Candle[]> = new Map();
  private maxCandles = 1000; // Держим в памяти 1000 последних

  constructor(binance: BinanceService) {
    this.binance = binance;
  }

  /**
   * Инициализация: загрузка истории и старт сокета
   */
  public async initialize(symbols: string[], timeframe: string, onCandleClosed: (symbol: string) => void) {
    // 1. Загружаем исторические данные (Snapshot)
    logger.info('MarketData', '📥 Fetching historical snapshots...');
    
    // Делаем это последовательно или Promise.all, чтобы не превысить лимиты при старте
    for (const symbol of symbols) {
      const history = await this.binance.getCandles(symbol, timeframe, this.maxCandles);
      this.candlesCache.set(symbol, history);
      logger.debug('MarketData', `Loaded ${history.length} candles for ${symbol}`);
    }

    // 2. Подключаемся к WebSocket
    this.binance.subscribeToCandles(symbols, timeframe, (streamData) => {
      this.handleStreamMessage(streamData, onCandleClosed);
    });
  }

  /**
   * Обработка сообщения из сокета
   */
  private handleStreamMessage(data: any, onCandleClosed: (symbol: string) => void) {
    const rawKline = data.k;
    const symbol = data.s; // Например "BTCUSDT"
    const isClosed = rawKline.x; // Флаг закрытия свечи

    const candle: Candle = {
      timestamp: rawKline.t,
      open: parseFloat(rawKline.o),
      high: parseFloat(rawKline.h),
      low: parseFloat(rawKline.l),
      close: parseFloat(rawKline.c),
      volume: parseFloat(rawKline.v)
    };

    const currentHistory = this.candlesCache.get(symbol) || [];

    // Логика синхронизации
    if (currentHistory.length > 0) {
      const lastCandle = currentHistory[currentHistory.length - 1];

      if (candle.timestamp === lastCandle.timestamp) {
        // Это обновление ТЕКУЩЕЙ свечи -> перезаписываем последнюю
        currentHistory[currentHistory.length - 1] = candle;
      } else if (candle.timestamp > lastCandle.timestamp) {
        // Это НОВАЯ свеча -> пушим в массив
        currentHistory.push(candle);
        // Обрезаем лишнее, чтобы память не утекала
        if (currentHistory.length > this.maxCandles) {
          currentHistory.shift();
        }
      }
    } else {
      currentHistory.push(candle);
    }

    this.candlesCache.set(symbol, currentHistory);

    // Если свеча закрылась — триггерим анализ!
    if (isClosed) {
      // logger.debug('MarketData', `Candle closed for ${symbol} @ ${candle.close}`);
      onCandleClosed(symbol);
    }
  }

  /**
   * Получить актуальные данные из памяти (для StrategyEngine)
   */
  public getCandles(symbol: string): Candle[] {
    return this.candlesCache.get(symbol) || [];
  }
  
  public getLastPrice(symbol: string): number {
    const candles = this.candlesCache.get(symbol);
    if (!candles || candles.length === 0) return 0;
    return candles[candles.length - 1].close;
  }
}