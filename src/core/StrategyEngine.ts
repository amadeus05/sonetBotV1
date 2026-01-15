import { Candle, MarketData, TradingSignal, SignalType, TrendDirection } from '../types';
import { RiskManager } from './RiskManager';
import { logger } from '../services/Logger';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';
import { RegimeDetector } from '../modules/RegimeDetector';

/**
 * ========================================================================
 * STRATEGY: Institutional Whale Momentum (v5.0 - The Profit King)
 * Focus: High Timeframe Alignment + Volatility Filtering + Massive RR
 * Goal: Survive the first half of 2025 by ignoring the noise.
 * ========================================================================
 */

enum SetupState {
  IDLE,
  WHALE_IMPULSE, // Замечен крупный игрок (объем + свеча)
  VALUE_PULLBACK, // Цена вернулась в зону выгодных покупок
}

interface RRSetup {
  state: SetupState;
  direction: TrendDirection;
  impulseATR: number;
  barsInState: number;
}

// --- КОНСТАНТЫ ДЛЯ ПОБЕДЫ ---
const MIN_ADX = 24;             // Сильный тренд
const MIN_ATR_PCT = 0.003;      // Минимум 0.3% волатильности (против комиссий)
const EMA_HTF_PERIOD = 1200;    // Прокси 1-часового тренда (5м * 1200 = 100 часов)
const VOL_SMA_PERIOD = 30;

const SL_ATR_MULT = 3.0;        // Широкий стоп для выживаемости
const TAKE_PROFIT_RR = 3.5;     // RR 1:3.5 - одна сделка кроет 4 стопа

export class StrategyEngine {
  private riskManager: RiskManager;
  private regimeDetector: RegimeDetector;
  private setups: Map<string, RRSetup> = new Map();

  constructor(riskManager: RiskManager) {
    this.riskManager = riskManager;
    this.regimeDetector = new RegimeDetector();
    logger.info('StrategyEngine', 'V5.0 Institutional Whale Edition Active');
  }

  public async analyze(marketData: MarketData): Promise<TradingSignal | null> {
    const { symbol, candles } = marketData;
    if (!candles || candles.length < EMA_HTF_PERIOD) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];

    // 1. ФИЛЬТР ВОЛАТИЛЬНОСТИ (Главный враг комиссий)
    const atrArr = TechnicalIndicators.atr(candles, 14);
    const currentAtr = atrArr[atrArr.length - 1];
    if ((currentAtr / last.close) < MIN_ATR_PCT) return null;

    // 2. ГЛОБАЛЬНЫЙ ТРЕНД (HTF FILTER)
    const closes = candles.map(c => c.close);
    const ema50 = TechnicalIndicators.ema(closes, 50).pop() || 0;
    const ema200 = TechnicalIndicators.ema(closes, 200).pop() || 0;
    const emaHtf = TechnicalIndicators.ema(closes, EMA_HTF_PERIOD).pop() || 0;

    // Цена должна быть выше часовой средней для лонга и ниже для шорта
    const isHtfBullish = last.close > emaHtf && ema50 > ema200;
    const isHtfBearish = last.close < emaHtf && ema50 < ema200;

    // 3. СИЛА ТРЕНДА (ADX)
    const adx = this.regimeDetector.calculateStandardADX(candles, 21);
    if (adx < MIN_ADX) {
      this.resetSetup(symbol);
      return null;
    }

    const setup = this.getOrInitSetup(symbol);

    // 4. STATE MACHINE
    switch (setup.state) {
      case SetupState.IDLE:
        // Ищем импульс на высоком объеме
        const volSma = TechnicalIndicators.volumeAverage(candles, VOL_SMA_PERIOD).pop() || 0;
        const impulseSize = Math.abs(last.close - last.open);

        if (last.volume > volSma * 1.5 && impulseSize > currentAtr * 1.2) {
          if (isHtfBullish && last.close > last.open) {
            setup.state = SetupState.WHALE_IMPULSE;
            setup.direction = TrendDirection.BULLISH;
          } else if (isHtfBearish && last.close < last.open) {
            setup.state = SetupState.WHALE_IMPULSE;
            setup.direction = TrendDirection.BEARISH;
          }
          setup.impulseATR = currentAtr;
          setup.barsInState = 0;
        }
        break;

      case SetupState.WHALE_IMPULSE:
        setup.barsInState++;
        // Проверяем начало коррекции (Pullback) к EMA 50
        const isCorrecting = setup.direction === TrendDirection.BULLISH ?
          last.close < prev.close : last.close > prev.close;

        if (isCorrecting) {
          setup.state = SetupState.VALUE_PULLBACK;
          setup.barsInState = 0;
        } else if (setup.barsInState > 6) {
          this.resetSetup(symbol);
        }
        break;

      case SetupState.VALUE_PULLBACK:
        setup.barsInState++;
        if (setup.barsInState > 20) { // Откат не может длиться вечно
          this.resetSetup(symbol);
          return null;
        }

        // Условие входа: Возврат в Value Zone (EMA 50) + Сигнал поглощения
        const inValueZone = setup.direction === TrendDirection.BULLISH ?
          (last.low <= ema50 * 1.002) : (last.high >= ema50 * 0.998);

        if (inValueZone) {
          const confirmed = setup.direction === TrendDirection.BULLISH ?
            (last.close > last.open && last.close > prev.high) :
            (last.close < last.open && last.close < prev.low);

          if (confirmed) {
            const signal = this.buildSignal(symbol, last.close, setup, currentAtr);
            const sizing = this.riskManager.calculatePositionSize(signal, candles);
            const sizedSignal = { ...signal, positionSize: sizing.size };

            if (this.riskManager.validateSignal(sizedSignal).valid) {
              console.log(`[WHALE ENTRY] ${symbol} | ADX: ${adx.toFixed(1)} | HTF: OK`);
              this.resetSetup(symbol);
              return sizedSignal;
            }
          }
        }
        break;
    }

    return null;
  }

  private buildSignal(symbol: string, entry: number, setup: RRSetup, atr: number): TradingSignal {
    const isLong = setup.direction === TrendDirection.BULLISH;
    const slDist = atr * SL_ATR_MULT;

    return {
      symbol,
      type: isLong ? SignalType.LONG : SignalType.SHORT,
      entry,
      stopLoss: isLong ? entry - slDist : entry + slDist,
      takeProfit: isLong ? entry + (slDist * TAKE_PROFIT_RR) : entry - (slDist * TAKE_PROFIT_RR),
      positionSize: 0,
      confidence: 1.0,
      timestamp: Date.now(),
      tags: ['v5.0_whale', 'htf_1200', 'high_atr'],
      metadata: { ...setup, atr }
    };
  }

  private getOrInitSetup(symbol: string): RRSetup {
    let s = this.setups.get(symbol);
    if (!s) {
      s = { state: SetupState.IDLE, direction: TrendDirection.NEUTRAL, impulseATR: 0, barsInState: 0 };
      this.setups.set(symbol, s);
    }
    return s;
  }

  private resetSetup(symbol: string) {
    this.setups.delete(symbol);
  }
}