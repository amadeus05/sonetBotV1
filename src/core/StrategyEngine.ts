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

    //TODO add MTF - This class should: provide a trust context, actually we can try with multiple tf confirmation like [15m,1h]

    // === INIT / LOAD SETUP ===
    let setup = this.setups.get(symbol);
    if (!setup) {
      setup = { state: SetupState.IDLE } as MomentumSetup;
      this.setups.set(symbol, setup);
    }

    // === GLOBAL REGIME FILTER ===
    const regime = this.regimeDetector.detect(candles);
    if (!this.regimeDetector.isTrendingRegime(regime)) {
      setup.state = SetupState.IDLE;
      return null;
    }

    // === TREND CONTEXT (NOT TIMING) ===
    const trend = this.trendAnalyzer.analyze(candles);

    switch (setup.state) {
      // =============================
      // IDLE — LOOK FOR IMPULSE
      // =============================
      case SetupState.IDLE: {
        if (!trend.isStrong || trend.direction === TrendDirection.NEUTRAL) {
          return null;
        }

        const momentum = this.momentumDetector.detect(candles);
        if (!momentum.hasSpike || momentum.direction !== trend.direction) {
          return null;
        }

        setup.state = SetupState.IMPULSE_DETECTED;
        setup.direction = trend.direction;
        setup.impulseHigh = momentum.high;
        setup.impulseLow = momentum.low;
        setup.impulseATR = momentum.atr;
        setup.impulseVolumeRatio = momentum.volumeRatio;
        setup.barsSinceImpulse = 0;

        this.debug(symbol, '🔥 IMPULSE DETECTED', setup);
        return null;
      }

      // =============================
      case SetupState.IMPULSE_DETECTED:
        setup.state = SetupState.WAITING_PULLBACK;
        return null;

      // =============================
      // WAITING FOR PULLBACK
      // =============================
      case SetupState.WAITING_PULLBACK: {
        setup.barsSinceImpulse++;

        // TIMEOUT
        if (setup.barsSinceImpulse > 12) {
          return this.invalidate(symbol, setup, 'TIMEOUT');
        }

        // STRUCTURAL INVALIDATION
        if (
          setup.direction === TrendDirection.BULLISH &&
          last.low < setup.impulseLow
        ) {
          return this.invalidate(symbol, setup, 'IMPULSE LOW BROKEN');
        }

        const pullback = this.pullbackScanner.scan(candles, {
          direction: setup.direction
        } as any);

        if (!pullback.occurred) return null;

        const depth =
          Math.abs(pullback.low - setup.impulseHigh) /
          Math.abs(setup.impulseHigh - setup.impulseLow);

        if (depth < 0.3 || depth > 0.6) {
          return null;
        }

        setup.pullbackLow = pullback.low;
        setup.pullbackHigh = pullback.high;
        setup.pullbackDepth = depth;
        setup.state = SetupState.PULLBACK_CONFIRMED;

        this.debug(symbol, `🟢 PULLBACK ${Math.round(depth * 100)}%`, setup);
        return null;
      }

      // =============================
      // CONFIRM REACTION
      // =============================
      case SetupState.PULLBACK_CONFIRMED: {
        const bouncing = this.pullbackScanner.isBouncing(
          candles,
          {
            low: setup.pullbackLow!,
            high: setup.pullbackHigh!
          } as any,
          setup.direction
        );

        if (!bouncing) return null;

        setup.state = SetupState.READY_TO_ENTER;
        this.debug(symbol, '🟡 READY TO ENTER', setup);
        return null;
      }

      // =============================
      // ENTRY
      // =============================
      case SetupState.READY_TO_ENTER: {
        const signal = this.generateSignal(symbol, candles, setup);
        if (!signal) return null;

        const validation = this.riskManager.validateSignal(signal);
        if (!validation.valid) {
          return this.invalidate(symbol, setup, validation.reason!);
        }

        setup.state = SetupState.ENTERED;
        this.debug(symbol, '🎯 ENTRY', signal);
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

    const stopLoss = isLong
      ? setup.pullbackLow! - setup.impulseATR * 0.25
      : setup.pullbackHigh! + setup.impulseATR * 0.25;

    const impulseRange = setup.impulseHigh - setup.impulseLow;

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

  private getTickSize(symbol: string): number {
    return 0.01; // TODO: replace with exchange-specific tick size
  }
}
