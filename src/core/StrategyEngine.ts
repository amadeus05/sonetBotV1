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
  direction: TrendDirection;

  impulseHigh: number;
  impulseLow: number;
  impulseATR: number;
  impulseVolumeRatio: number;

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
    const last = candles[candles.length - 1];

    this.debug(symbol, `📊 ANALYZE CALLED`, {
      candlesCount: candles.length,
      lastCandle: { o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume, ts: last.timestamp }
    });

    // === INIT / LOAD SETUP ===
    let setup = this.setups.get(symbol);
    if (!setup) {
      setup = { state: SetupState.IDLE } as MomentumSetup;
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
      setup.state = SetupState.IDLE;
      return null;
    }

    // === TREND CONTEXT (NOT TIMING) ===
    const trend = this.trendAnalyzer.analyze(candles);
    this.debug(symbol, `📉 TREND`, { direction: TrendDirection[trend.direction], isStrong: trend.isStrong, strength: trend.strength });

    switch (setup.state) {
      // =============================
      // IDLE — LOOK FOR IMPULSE
      // =============================
      case SetupState.IDLE: {
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

        this.debug(symbol, '🔥 IMPULSE DETECTED → WAITING_PULLBACK', {
          direction: TrendDirection[setup.direction],
          impulseHigh: setup.impulseHigh,
          impulseLow: setup.impulseLow,
          impulseATR: setup.impulseATR,
          volumeRatio: setup.impulseVolumeRatio
        });
        return null;
      }

      // =============================
      case SetupState.IMPULSE_DETECTED:
        this.info(symbol, '➡️ IMPULSE_DETECTED → WAITING_PULLBACK');
        setup.state = SetupState.WAITING_PULLBACK;
        return null;

      // =============================
      // WAITING FOR PULLBACK
      // =============================
      case SetupState.WAITING_PULLBACK: {
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
        // Fall through to check bounce
      }

      // =============================
      // CONFIRM REACTION & IMMEDIATE ENTRY
      // =============================
      case SetupState.PULLBACK_CONFIRMED: {
        this.debug(symbol, `🔍 CHECKING BOUNCE`, {
          pullbackLow: setup.pullbackLow,
          pullbackHigh: setup.pullbackHigh,
          direction: TrendDirection[setup.direction]
        });

        const bouncing = this.pullbackScanner.isBouncing(
          candles,
          {
            occurred: true,
            low: setup.pullbackLow!,
            high: setup.pullbackHigh!,
            level: setup.direction === TrendDirection.BULLISH ? setup.pullbackLow! : setup.pullbackHigh!,
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
      }

      // =============================
      // ENTRY
      // =============================
      case SetupState.READY_TO_ENTER: {
        this.debug(symbol, '🚀 READY_TO_ENTER - generating signal...');
        const signal = this.generateSignal(symbol, candles, setup);

        this.info(symbol, '📋 GENERATED SIGNAL', {
          type: signal.type,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          confidence: signal.confidence,
          positionSize: signal.positionSize
        });

        if (!signal) {
          this.debug(symbol, '❌ SIGNAL GENERATION FAILED');
          return null;
        }

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
      case SetupState.ENTERED:
        setup.state = SetupState.IDLE;
        return null;

      case SetupState.INVALIDATED:
        setup.state = SetupState.IDLE;
        return null;
    }
  }

  // =========================
  // SIGNAL GENERATION
  // =========================

private generateSignal(
  symbol: string,
  candles: Candle[],
  setup: MomentumSetup
): TradingSignal {
  const isLong = setup.direction === TrendDirection.BULLISH;

  const entry = isLong
    ? setup.pullbackHigh! + this.getTickSize(symbol)
    : setup.pullbackLow! - this.getTickSize(symbol);

  // FIXED: Use 3x ATR instead of 2x for more breathing room
  // Also add a minimum distance based on the impulse range
  const impulseRange = setup.impulseHigh - setup.impulseLow;
  const atrBuffer = setup.impulseATR * 3; // Changed from 2 to 3
  const minBuffer = impulseRange * 0.15; // At least 15% of impulse range
  
  const buffer = Math.max(atrBuffer, minBuffer);

  const stopLoss = isLong
    ? setup.pullbackLow! - buffer
    : setup.pullbackHigh! + buffer;

  // Keep the 1.5x R:R for take profit
  const takeProfit = isLong
    ? entry + impulseRange * 1.5
    : entry - impulseRange * 1.5;

  const confidence = Math.min(
    0.4 +
    Math.min(setup.impulseVolumeRatio * 0.2, 0.3) +
    Math.min((impulseRange / setup.impulseATR) * 0.2, 0.3),
    1
  );

  const signal: TradingSignal = {
    symbol,
    type: isLong ? SignalType.LONG : SignalType.SHORT,
    entry,
    stopLoss,
    takeProfit,
    positionSize: 0,
    confidence,
    timestamp: Date.now(),
    tags: [
      'momentum_pullback',
      `pb:${Math.round(setup.pullbackDepth! * 100)}%`,
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
