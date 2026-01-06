import {
  Candle,
  MarketData,
  TradingSignal,
  SignalType,
  TrendDirection,
} from '../types';
import { TrendAnalyzer } from '../modules/TrendAnalyzer';
import { MomentumDetector } from '../modules/MomentumDetector';
import { PullbackScanner } from '../modules/PullbackScanner';
import { RegimeDetector } from '../modules/RegimeDetector';
import { RiskManager } from './RiskManager';
import { logger } from '../services/Logger';

// =========================
// STATE MACHINE DEFINITIONS
// =========================

enum SetupState {
  IDLE,
  IMPULSE_DETECTED,
  WAITING_PULLBACK,
  PULLBACK_CONFIRMED,
  READY_TO_ENTER,
  ENTERED,
  INVALIDATED
}

interface MomentumSetup {
  state: SetupState;
  direction?: TrendDirection;

  impulseHigh?: number;
  impulseLow?: number;
  impulseATR?: number;
  impulseVolumeRatio?: number;
  /**
   * Доп. метрики импульса для расчёта confidence.
   * Важно: не используем их для SL/TP и инвалидации, чтобы не менять механику сетапа.
   */
  impulseRangeToATR?: number; // (high-low) последней свечи / ATR
  impulseBodyToATR?: number;  // |close-open| последней свечи / ATR
  impulsePriceChange?: number; // % изменение цены (lookback в MomentumDetector)

  barsSinceImpulse: number;

  pullbackHigh?: number;
  pullbackLow?: number;
  pullbackDepth?: number;
}

// =========================
// STRATEGY ENGINE
// =========================

export class StrategyEngine {
  private trendAnalyzer = new TrendAnalyzer();
  private momentumDetector = new MomentumDetector();
  private pullbackScanner = new PullbackScanner();
  private regimeDetector = new RegimeDetector();
  private riskManager: RiskManager;

  // STATE PER SYMBOL
  private setups: Map<string, MomentumSetup> = new Map();

  constructor(riskManager: RiskManager) {
    this.riskManager = riskManager;
    logger.info('StrategyEngine', 'Initialized (Stateful Momentum Pullback)');
  }

  // =========================
  // MAIN ANALYSIS LOOP
  // =========================

  public async analyze(marketData: MarketData): Promise<TradingSignal | null> {
    const { symbol, candles } = marketData;
    if (!candles || candles.length === 0) {
      this.debug(symbol, `⏸️ ANALYZE: NO CANDLES`);
      return null;
    }
    const last = candles[candles.length - 1];

    this.debug(symbol, `📊 ANALYZE CALLED`, {
      candlesCount: candles.length,
      lastCandle: { o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume, ts: last.timestamp }
    });

    // === INIT / LOAD SETUP ===
    let setup = this.setups.get(symbol);
    if (!setup) {
      setup = this.createIdleSetup();
      this.setups.set(symbol, setup);
      this.info(symbol, '🆕 NEW SETUP CREATED (IDLE)');
    }

    const stateName = SetupState[setup.state];
    this.debug(symbol, `🔄 CURRENT STATE: ${stateName}`);

    // === GLOBAL REGIME FILTER ===
    const regime = this.regimeDetector.detect(candles);
    const isTrending = this.regimeDetector.isTrendingRegime(regime);
    this.debug(symbol, `📈 REGIME`, { regime, isTrending });

    if (!isTrending) {
      this.debug(symbol, `⏸️ REGIME FILTER BLOCKED - Not trending, resetting to IDLE`);
      this.resetSetup(symbol, setup, 'REGIME_FILTER: NOT TRENDING');
      return null;
    }

    // === TREND CONTEXT (NOT TIMING) ===
    const trend = this.trendAnalyzer.analyze(candles);
    this.debug(symbol, `📉 TREND`, { direction: TrendDirection[trend.direction], isStrong: trend.isStrong, strength: trend.strength });

    // Явная стейт-машина без switch-fallthrough:
    // разрешаем ограниченное число "прогрессирующих" переходов в рамках одного analyze()
    // (сохраняем прежнюю механику: IMPULSE_DETECTED -> WAITING_PULLBACK и т.д.)
    let guard = 0;
    while (guard++ < 5) {
      switch (setup.state) {
        // =============================
        // IDLE — LOOK FOR IMPULSE
        // =============================
        case SetupState.IDLE: {
          // В IDLE начинаем с чистого листа, но не спамим reset-логами, если сетап уже чистый.
          const hasStaleFields =
            setup.direction != null ||
            setup.impulseHigh != null ||
            setup.impulseLow != null ||
            setup.impulseATR != null ||
            setup.impulseVolumeRatio != null ||
            setup.pullbackHigh != null ||
            setup.pullbackLow != null ||
            setup.pullbackDepth != null ||
            setup.barsSinceImpulse !== 0;

          if (hasStaleFields) {
            this.resetSetup(symbol, setup, 'ENTERED IDLE');
          } else if (setup.barsSinceImpulse !== 0) {
            setup.barsSinceImpulse = 0;
          }

          if (!trend.isStrong || trend.direction === TrendDirection.NEUTRAL) {
            this.debug(symbol, `⏸️ IDLE: WEAK TREND or NEUTRAL`, { isStrong: trend.isStrong, direction: TrendDirection[trend.direction] });
            return null;
          }

          const momentum = this.momentumDetector.detect(candles);
          this.debug(symbol, `⚡ MOMENTUM CHECK`, {
            hasSpike: momentum.hasSpike,
            momDirection: TrendDirection[momentum.direction],
            trendDirection: TrendDirection[trend.direction],
            volumeRatio: momentum.volumeRatio,
            atr: momentum.atr,
            high: momentum.high,
            low: momentum.low
          });

          if (!momentum.hasSpike) {
            this.debug(symbol, `⏸️ IDLE: NO SPIKE`);
            return null;
          }
          if (momentum.direction !== trend.direction) {
            this.debug(symbol, `⏸️ IDLE: DIRECTION MISMATCH (momentum: ${TrendDirection[momentum.direction]}, trend: ${TrendDirection[trend.direction]})`);
            return null;
          }

          setup.state = SetupState.IMPULSE_DETECTED;
          setup.direction = trend.direction;
          setup.impulseHigh = momentum.high;
          setup.impulseLow = momentum.low;
          setup.impulseATR = momentum.atr;
          setup.impulseVolumeRatio = momentum.volumeRatio;
          setup.barsSinceImpulse = 0;

          // Метрики силы импульса (чтобы confidence не "залипал" на 1 из-за high-low за 14 свечей)
          // Используем последнюю свечу как прокси для импульса (spike детектится по текущим условиям).
          const candleRange = last.high - last.low;
          const candleBody = Math.abs(last.close - last.open);
          const atr = setup.impulseATR ?? 0;
          setup.impulseRangeToATR = atr > 0 ? candleRange / atr : 0;
          setup.impulseBodyToATR = atr > 0 ? candleBody / atr : 0;
          setup.impulsePriceChange = momentum.priceChange;

          this.debug(symbol, '🔥 IMPULSE DETECTED → WAITING_PULLBACK', {
            direction: TrendDirection[setup.direction],
            impulseHigh: setup.impulseHigh,
            impulseLow: setup.impulseLow,
            impulseATR: setup.impulseATR,
            volumeRatio: setup.impulseVolumeRatio,
            impulseRangeToATR: setup.impulseRangeToATR,
            impulseBodyToATR: setup.impulseBodyToATR,
            impulsePriceChange: setup.impulsePriceChange
          });
          return null;
        }

        // =============================
        case SetupState.IMPULSE_DETECTED: {
          this.info(symbol, '➡️ IMPULSE_DETECTED → WAITING_PULLBACK');
          setup.state = SetupState.WAITING_PULLBACK;
          // продолжаем в рамках того же analyze() (сохраняем прежнюю механику)
          continue;
        }

        // =============================
        // WAITING FOR PULLBACK
        // =============================
        case SetupState.WAITING_PULLBACK: {
          // Санити-чек данных сетапа
          if (
            setup.direction == null ||
            setup.impulseHigh == null ||
            setup.impulseLow == null ||
            setup.barsSinceImpulse == null
          ) {
            this.info(symbol, '🧹 WAITING_PULLBACK: missing setup fields → reset to IDLE', setup);
            this.resetSetup(symbol, setup, 'MISSING_FIELDS_IN_WAITING_PULLBACK');
            return null;
          }

          setup.barsSinceImpulse++;
          this.debug(symbol, `⏳ WAITING_PULLBACK bar ${setup.barsSinceImpulse}/12`);

          // TIMEOUT
          if (setup.barsSinceImpulse > 30) {
            this.info(symbol, `⏱️ TIMEOUT after 12 bars`);
            return this.invalidate(symbol, setup, 'TIMEOUT');
          }

          // STRUCTURAL INVALIDATION (both directions)
          if (setup.direction === TrendDirection.BULLISH && last.low < setup.impulseLow) {
            this.info(symbol, `💥 BULLISH INVALIDATION: low ${last.low} < impulseLow ${setup.impulseLow}`);
            return this.invalidate(symbol, setup, 'IMPULSE LOW BROKEN');
          }
          if (setup.direction === TrendDirection.BEARISH && last.high > setup.impulseHigh) {
            this.info(symbol, `💥 BEARISH INVALIDATION: high ${last.high} > impulseHigh ${setup.impulseHigh}`);
            return this.invalidate(symbol, setup, 'IMPULSE HIGH BROKEN');
          }

          // Pass full trend object (scanner requires isStrong and emaFast)
          const pullback = this.pullbackScanner.scan(candles, trend);

          this.debug(symbol, `🔍 PULLBACK SCAN`, {
            occurred: pullback.occurred,
            low: pullback.low,
            high: pullback.high
          });

          if (!pullback.occurred) {
            this.debug(symbol, `⏸️ NO PULLBACK YET`);
            return null;
          }

          // SIMPLIFIED: Just check if pullback is valid (scanner handles depth internally)
          if (!pullback.isValid) {
            this.debug(symbol, `⏸️ PULLBACK INVALID (distance: ${pullback.distanceFromEMA.toFixed(2)}%)`);
            return null;
          }

          setup.pullbackLow = pullback.low;
          setup.pullbackHigh = pullback.high;
          setup.pullbackDepth = pullback.distanceFromEMA / 100; // Store as decimal
          setup.state = SetupState.PULLBACK_CONFIRMED;

          this.info(symbol, `🟢 PULLBACK CONFIRMED (${pullback.distanceFromEMA.toFixed(2)}% from EMA) → checking bounce`, setup);
          // продолжаем — проверим bounce в том же analyze() как раньше (fallthrough)
          continue;
        }

        // =============================
        // CONFIRM REACTION & IMMEDIATE ENTRY
        // =============================
        case SetupState.PULLBACK_CONFIRMED: {
          if (setup.direction == null || setup.pullbackLow == null || setup.pullbackHigh == null) {
            this.info(symbol, '🧹 PULLBACK_CONFIRMED: missing fields → reset to IDLE', setup);
            this.resetSetup(symbol, setup, 'MISSING_FIELDS_IN_PULLBACK_CONFIRMED');
            return null;
          }

          this.debug(symbol, `🔍 CHECKING BOUNCE`, {
            pullbackLow: setup.pullbackLow,
            pullbackHigh: setup.pullbackHigh,
            direction: TrendDirection[setup.direction]
          });

          const bouncing = this.pullbackScanner.isBouncing(
            candles,
            {
              occurred: true,
              low: setup.pullbackLow,
              high: setup.pullbackHigh,
              level: setup.direction === TrendDirection.BULLISH ? setup.pullbackLow : setup.pullbackHigh,
              distanceFromEMA: 0,
              isValid: true
            },
            setup.direction
          );

          this.debug(symbol, `🏀 BOUNCE CHECK`, { bouncing });

          if (!bouncing) {
            this.debug(symbol, `⏸️ NO BOUNCE YET - waiting for confirmation`);
            return null;
          }

          this.debug(symbol, '🟡 BOUNCE CONFIRMED → READY_TO_ENTER', setup);
          setup.state = SetupState.READY_TO_ENTER;
          continue;
        }

        // =============================
        // ENTRY
        // =============================
        case SetupState.READY_TO_ENTER: {
          this.debug(symbol, '🚀 READY_TO_ENTER - generating signal...');
          const signal = this.generateSignal(symbol, candles, setup);
          if (!signal) {
            return this.invalidate(symbol, setup, 'SIGNAL_GENERATION_FAILED');
          }

          this.info(symbol, '📋 GENERATED SIGNAL', {
            type: signal.type,
            entry: signal.entry,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            confidence: signal.confidence,
            positionSize: signal.positionSize
          });

          const validation = this.riskManager.validateSignal(signal);
          this.info(symbol, '✅ RISK VALIDATION', { valid: validation.valid, reason: validation.reason });

          if (!validation.valid) {
            this.info(symbol, `❌ RISK REJECTED: ${validation.reason}`);
            return this.invalidate(symbol, setup, validation.reason!);
          }

          setup.state = SetupState.ENTERED;
          this.info(symbol, '🎯🎯🎯 TRADE SIGNAL EMITTED!', signal);
          return signal;
        }

        // =============================
        case SetupState.ENTERED: {
          this.resetSetup(symbol, setup, 'ENTERED: cleanup');
          return null;
        }

        case SetupState.INVALIDATED: {
          this.resetSetup(symbol, setup, 'INVALIDATED: cleanup');
          return null;
        }

        default: {
          this.info(symbol, '🧯 UNKNOWN STATE → reset to IDLE', { state: setup.state });
          this.resetSetup(symbol, setup, 'UNKNOWN_STATE');
          return null;
        }
      }
    }

    // если мы попали сюда, значит зациклились на переходах — сбросимся безопасно
    this.info(symbol, '🧯 STATE LOOP GUARD TRIGGERED → reset to IDLE', setup);
    this.resetSetup(symbol, setup, 'STATE_LOOP_GUARD');
    return null;
  }

  // =========================
  // SIGNAL GENERATION
  // =========================

  private generateSignal(
    symbol: string,
    candles: Candle[],
    setup: MomentumSetup
  ): TradingSignal | null {
    if (
      setup.direction == null ||
      setup.pullbackHigh == null ||
      setup.pullbackLow == null ||
      setup.impulseHigh == null ||
      setup.impulseLow == null ||
      setup.impulseATR == null ||
      setup.impulseVolumeRatio == null ||
      setup.barsSinceImpulse == null
    ) {
      this.info(symbol, '❌ generateSignal: missing setup fields', setup);
      return null;
    }

    const isLong = setup.direction === TrendDirection.BULLISH;

    const entry = isLong
      ? setup.pullbackHigh + this.getTickSize(symbol)
      : setup.pullbackLow - this.getTickSize(symbol);

    const impulseRange = setup.impulseHigh - setup.impulseLow;
    
    // SL: ATR * 2.5 (чуть плотнее, чем 3)
    const atrBuffer = setup.impulseATR * 2.5; 
    const minBuffer = impulseRange * 0.15;
    const buffer = Math.max(atrBuffer, minBuffer);

    const stopLoss = isLong
      ? setup.pullbackLow - buffer
      : setup.pullbackHigh + buffer;

    const takeProfit = isLong
      ? entry + impulseRange * 1.5
      : entry - impulseRange * 1.5;

    // --- CONFIDENCE (НЕ ДОЛЖЕН "ЗАЛИПАТЬ" НА 1.0) ---
    // Вместо жёстких ступенек/кэпов используем нормализованные компоненты 0..1.
    const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

    // 1) Объём: 1.5x = 0, 4.0x+ = 1
    const volN = clamp01((setup.impulseVolumeRatio - 1.5) / 2.5);

    // 2) Сила импульса: используем последнюю свечу (range/body) относительно ATR
    // 0 при <0.8 ATR, 1 при >=2.0 ATR
    const rangeToAtr = setup.impulseRangeToATR ?? 0;
    const bodyToAtr = setup.impulseBodyToATR ?? 0;
    const impulseStrength = Math.max(bodyToAtr, rangeToAtr * 0.7);
    const momN = clamp01((impulseStrength - 0.8) / 1.2);

    // 3) Качество отката: чем ближе к EMA, тем лучше (в пределах maxPullbackDistance)
    // pullbackDepth хранится как decimal (0.01 = 1%)
    const maxPb = 0.03; // соответствует дефолту MAX_PULLBACK_DISTANCE в ConfigManager
    const depth = setup.pullbackDepth ?? maxPb;
    const depthN = clamp01(1 - (depth / maxPb));

    // База + веса (макс = 1.0 только когда всё идеально, что бывает редко)
    const base = 0.25;
    const confidence = clamp01(
      base +
      volN * 0.30 +
      momN * 0.30 +
      depthN * 0.15
    );
    // -----------------------------------------------

    const signal: TradingSignal = {
      symbol,
      type: isLong ? SignalType.LONG : SignalType.SHORT,
      entry,
      stopLoss,
      takeProfit,
      positionSize: 0,
      confidence, // Теперь реально плавает, а не упирается в 1.0 почти всегда
      timestamp: Date.now(),
      tags: [
        'momentum_pullback',
        `pb:${(depth * 100).toFixed(2)}%`,
        `bars:${setup.barsSinceImpulse}`
      ],
      metadata: setup
    };

    this.info(symbol, '📋 GENERATED SIGNAL', signal);

    const sizing = this.riskManager.calculatePositionSize(signal, candles);

    return {
      ...signal,
      positionSize: sizing.size
    };
  }

  // =========================
  // HELPERS
  // =========================

  private invalidate(
    symbol: string,
    setup: MomentumSetup,
    reason: string
  ): null {
    this.debug(symbol, `❌ INVALIDATED: ${reason}`, setup);
    setup.state = SetupState.INVALIDATED;
    return null;
  }

  private createIdleSetup(): MomentumSetup {
    return {
      state: SetupState.IDLE,
      barsSinceImpulse: 0
    };
  }

  private resetSetup(symbol: string, setup: MomentumSetup, reason: string) {
    // Очищаем все вычисленные поля, чтобы не тащить "хвосты" в метаданные/логи.
    // direction/impulse/pullback будут проставлены заново при новом сетапе.
    this.debug(symbol, `🧹 RESET SETUP → IDLE (${reason})`, setup);

    setup.state = SetupState.IDLE;
    setup.barsSinceImpulse = 0;

    delete setup.direction;
    delete setup.impulseHigh;
    delete setup.impulseLow;
    delete setup.impulseATR;
    delete setup.impulseVolumeRatio;
    delete setup.impulseRangeToATR;
    delete setup.impulseBodyToATR;
    delete setup.impulsePriceChange;
    delete setup.pullbackHigh;
    delete setup.pullbackLow;
    delete setup.pullbackDepth;
  }

  private debug(symbol: string, label: string, data?: any) {
    logger.debug('STRATEGY', `${symbol} | ${label}`, data);
  }

  private info(symbol: string, label: string, data?: any) {
    logger.info('STRATEGY', `${symbol} | ${label}`, data);
  }

  private getTickSize(symbol: string): number {
    return 0.01; // TODO: replace with exchange-specific tick size
  }
}
