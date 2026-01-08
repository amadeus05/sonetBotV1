import { injectable, inject } from 'inversify';
import {
  Candle,
  MarketData,
  PullbackAnalysis,
  TradingSignal,
  SignalType,
  TrendDirection,
} from '../../types';
import { TrendAnalyzer } from '../analysis/TrendAnalyzer';
import { MomentumDetector } from '../analysis/MomentumDetector';
import { PullbackScanner } from '../analysis/PullbackScanner';
import { RegimeDetector } from '../analysis/RegimeDetector';
import { IRiskManager } from '../interfaces/IRiskManager';
import { IStrategy } from '../interfaces/IStrategy';
import { ConfigService } from '../../infrastructure/config/ConfigService';
import { logger } from '../../infrastructure/logging/Logger';
import { TYPES } from '../../di/types';

enum SetupState {
  IDLE,
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
  pullback?: PullbackAnalysis;
}

@injectable()
export class MomentumStrategy implements IStrategy {
  private setups: Map<string, MomentumSetup> = new Map();

  constructor(
    @inject(TYPES.IRiskManager) private readonly riskManager: IRiskManager,
    @inject(TYPES.IConfigService) private readonly configService: ConfigService,
    @inject(TYPES.TrendAnalyzer) private readonly trendAnalyzer: TrendAnalyzer,
    @inject(TYPES.MomentumDetector) private readonly momentumDetector: MomentumDetector,
    @inject(TYPES.PullbackScanner) private readonly pullbackScanner: PullbackScanner,
    @inject(TYPES.RegimeDetector) private readonly regimeDetector: RegimeDetector
  ) {
    logger.info('StrategyEngine', 'Initialized (Stateful Momentum Pullback v5.0 - Conservative)');
  }

  public async analyze(marketData: MarketData): Promise<TradingSignal | null> {
    const { symbol, candles } = marketData;
    const last = candles[candles.length - 1];

    let setup = this.setups.get(symbol);
    if (!setup) {
      this.resetSetup(symbol);
      setup = this.setups.get(symbol)!;
      this.info(symbol, '🆕 NEW SETUP CREATED (IDLE)');
    }

    // === 1. STRICT REGIME FILTER ===
    // Только явные тренды. Никакого флэта.
    const regime = this.regimeDetector.detect(candles);
    const isTrending = this.regimeDetector.isTrendingRegime(regime);

    // If regime is not trending, do not start new setups AND invalidate existing ones.
    if (!isTrending) {
      if (setup.state === SetupState.IDLE) return null;
      return this.invalidate(symbol, `REGIME_NOT_TRENDING:${regime}`);
    }

    const trend = this.trendAnalyzer.analyze(candles);

    switch (setup.state) {
      // ---------------------------------------------------------
      case SetupState.IDLE: {
        if (!trend.isStrong || trend.direction === TrendDirection.NEUTRAL) return null;

        const momentum = this.momentumDetector.detect(candles);
        if (!momentum.hasSpike) return null;
        if (momentum.direction !== trend.direction) return null;

        // Фильтр объема: Входим только если объем импульса был заметным (>1.2x)
        if (momentum.volumeRatio < 1.2) return null;

        setup.state = SetupState.WAITING_PULLBACK;
        setup.direction = trend.direction;
        setup.impulseHigh = momentum.high;
        setup.impulseLow = momentum.low;
        setup.impulseATR = momentum.atr;
        setup.impulseVolumeRatio = momentum.volumeRatio;
        setup.barsSinceImpulse = 0;

        this.info(symbol, '🔥 IMPULSE DETECTED → WAITING_PULLBACK', {
          dir: setup.direction,
          vol: setup.impulseVolumeRatio.toFixed(2)
        });
        return null;
      }

      // ---------------------------------------------------------
      case SetupState.WAITING_PULLBACK: {
        setup.barsSinceImpulse++;

        // Timeout 50 bars
        if (setup.barsSinceImpulse > 50) {
          this.info(symbol, `⏱️ TIMEOUT after 50 bars`);
          return this.invalidate(symbol, 'TIMEOUT');
        }

        // Structural Break
        if (setup.direction === TrendDirection.BULLISH && last.low < setup.impulseLow) return this.invalidate(symbol, 'IMPULSE LOW BROKEN');
        if (setup.direction === TrendDirection.BEARISH && last.high > setup.impulseHigh) return this.invalidate(symbol, 'IMPULSE HIGH BROKEN');

        const pullback = this.pullbackScanner.scan(candles, trend);
        if (!pullback.occurred) return null;
        if (!pullback.isValid) return null;

        // Sanity checks for pullback numbers
        if (
          !Number.isFinite(pullback.level) ||
          !Number.isFinite(pullback.low) ||
          !Number.isFinite(pullback.high)
        ) {
          return this.invalidate(symbol, 'BAD_PULLBACK_NUMBERS');
        }

        const isLong = setup.direction === TrendDirection.BULLISH;
        const impulseRange = setup.impulseHigh - setup.impulseLow;

        // Safety: protect against division by zero / NaN fib computations
        if (!Number.isFinite(impulseRange) || impulseRange <= 0) {
          return this.invalidate(symbol, 'BAD_IMPULSE_RANGE');
        }

        let currentPullbackDist = 0;
        if (isLong) {
          // Use pullback.level (swing low) to measure depth, not mixed low/high fields.
          currentPullbackDist = setup.impulseHigh - pullback.level;
        } else {
          // Use pullback.level (swing high) to measure depth.
          currentPullbackDist = pullback.level - setup.impulseLow;
        }

        const fibLevel = currentPullbackDist / impulseRange;
        if (!Number.isFinite(fibLevel)) {
          return this.invalidate(symbol, 'BAD_FIB_LEVEL');
        }

        // FILTER: 30% - 70% (Не берем слишком глубокие откаты, это признак слабости)
        if (fibLevel < 0.3 || fibLevel > 0.7) {
          return null;
        }

        setup.pullbackLow = pullback.low;
        setup.pullbackHigh = pullback.high;
        setup.pullbackDepth = pullback.distanceFromEMA / 100;
        setup.pullback = pullback;
        setup.state = SetupState.PULLBACK_CONFIRMED;

        this.info(symbol, `🟢 PULLBACK CONFIRMED (Fib: ${fibLevel.toFixed(2)}) → checking bounce`, setup);
        // Important: do not fall-through; wait for next analyze() call to confirm bounce
        return null;
      }

      // ---------------------------------------------------------
      case SetupState.PULLBACK_CONFIRMED: {
        if (!setup.pullback) return this.invalidate(symbol, 'PULLBACK_MISSING');
        const bouncing = this.pullbackScanner.isBouncing(
          candles,
          setup.pullback,
          setup.direction
        );

        if (!bouncing) {
          const isLong = setup.direction === TrendDirection.BULLISH;
          if (isLong && last.close < setup.pullbackLow!) return this.invalidate(symbol, 'LOWER LOW');
          if (!isLong && last.close > setup.pullbackHigh!) return this.invalidate(symbol, 'HIGHER HIGH');
          return null;
        }

        setup.state = SetupState.READY_TO_ENTER;
        // Important: do not fall-through; generate signal on next analyze() call
        return null;
      }

      // ---------------------------------------------------------
      case SetupState.READY_TO_ENTER: {
        const signal = this.generateSignal(symbol, candles, setup);

        // Note: Signal validation (max trades, risk limits) happens at Application layer
        // StrategyEngine is a pure signal generator - it doesn't access account state

        setup.state = SetupState.ENTERED;
        this.info(symbol, '🎯🎯🎯 TRADE SIGNAL EMITTED!', signal);
        return signal;
      }

      case SetupState.ENTERED:
        this.resetSetup(symbol);
        return null;

      case SetupState.INVALIDATED:
        this.resetSetup(symbol);
        return null;
    }
  }

  // =========================
  // SIGNAL GENERATION (Smart Breakout)
  // =========================

  private generateSignal(
    symbol: string,
    candles: Candle[],
    setup: MomentumSetup
  ): TradingSignal {
    const isLong = setup.direction === TrendDirection.BULLISH;

    // Вход с минимальным отступом, чтобы не платить лишнее за "подтверждение"
    const entryBuffer = setup.impulseATR * 0.05;

    let entry = 0;
    if (isLong) {
      entry = setup.pullbackHigh! + entryBuffer;
    } else {
      entry = setup.pullbackLow! - entryBuffer;
    }

    const impulseRange = setup.impulseHigh - setup.impulseLow;

    // STOP LOSS: 2.0 ATR (Классика)
    // Если рынок выбивает 2 ATR, значит тренда нет.
    const atrBuffer = setup.impulseATR * 2.0;

    const stopLoss = isLong
      ? setup.pullbackLow! - atrBuffer
      : setup.pullbackHigh! + atrBuffer;

    // TAKE PROFIT: 1.3 ATR (Консервативно, но вероятнее)
    // Мы не жадничаем. Нам нужно забрать прибыль и уйти.
    // 1.3 - это часто R:R около 1.5-2.0 при узком стопе, но при 2 ATR стопе это может быть меньше.
    // Поэтому используем MAX(ImpulseRange, 3 ATR) для тейка

    const targetDist = Math.max(impulseRange, setup.impulseATR * 3.0);

    const takeProfit = isLong
      ? entry + targetDist
      : entry - targetDist;

    // --- CONFIDENCE ---
    // Confidence is a "setup quality score" (0..1), not a probability of winning.
    // Goal: meaningful spread (not a near-constant 0.8-1.0).
    const confidence = this.calculateConfidence(candles, setup);

    // Use pure position sizing calculation
    const accountBalance = this.configService.getRiskConfig().accountBalance;
    const sizing = this.riskManager.calculatePositionSize(entry, stopLoss, accountBalance, confidence);

    const signal: TradingSignal = {
      symbol,
      type: isLong ? SignalType.LONG : SignalType.SHORT,
      entry,
      stopLoss,
      takeProfit,
      positionSize: sizing.size,
      confidence,
      timestamp: Date.now(),
      tags: ['momentum_pullback', `vol:${setup.impulseVolumeRatio.toFixed(1)}`],
      metadata: setup
    };

    return signal;
  }

  // =========================
  // HELPERS
  // =========================

  private calculateConfidence(candles: Candle[], setup: MomentumSetup): number {
    const last = candles[candles.length - 1];
    const prev = candles.length >= 2 ? candles[candles.length - 2] : last;

    const clamp01 = (v: number) => Math.max(0, Math.min(v, 1));

    // 1) Volume quality (1.0x..3.0x mapped to 0..1)
    const volumeScore = clamp01((setup.impulseVolumeRatio - 1.0) / 2.0);

    // 2) Recency: fresher impulse is better (0..50 bars)
    const recencyScore = clamp01(1 - (setup.barsSinceImpulse / 50));

    // 3) Pullback depth around "ideal" ~0.5 fib within [0.3..0.7]
    let fibScore = 0.5;
    if (setup.pullback) {
      const impulseRange = setup.impulseHigh - setup.impulseLow;
      if (Number.isFinite(impulseRange) && impulseRange > 0) {
        const isLong = setup.direction === TrendDirection.BULLISH;
        const pullbackDist = isLong
          ? (setup.impulseHigh - setup.pullback.level)
          : (setup.pullback.level - setup.impulseLow);
        const fib = pullbackDist / impulseRange; // expected 0.3..0.7 by filter
        // Peak at 0.5, drops to 0 at +/-0.2
        fibScore = clamp01(1 - (Math.abs(fib - 0.5) / 0.2));
      }
    }

    // 4) Pullback distance from EMA: smaller is better (heuristic; 1.5% -> 0)
    let pullbackDistanceScore = 0.5;
    if (setup.pullback && Number.isFinite(setup.pullback.distanceFromEMA)) {
      pullbackDistanceScore = clamp01(1 - (setup.pullback.distanceFromEMA / 1.5));
    }

    // 5) Bounce "strength" (simple): last candle continuation in trend direction
    const isLong = setup.direction === TrendDirection.BULLISH;
    const bounceScore = clamp01(
      isLong
        ? (last.close > last.open ? 0.7 : 0.3) + (last.close > prev.close ? 0.3 : 0)
        : (last.close < last.open ? 0.7 : 0.3) + (last.close < prev.close ? 0.3 : 0)
    );

    // Weighted blend
    const score =
      volumeScore * 0.20 +
      recencyScore * 0.20 +
      fibScore * 0.25 +
      pullbackDistanceScore * 0.20 +
      bounceScore * 0.15;

    // Keep within reasonable bounds for sizing logic; reject signals elsewhere if too low
    return clamp01(score);
  }

  private resetSetup(symbol: string): void {
    this.setups.set(symbol, {
      state: SetupState.IDLE,
      direction: TrendDirection.NEUTRAL,
      impulseHigh: 0, impulseLow: 0, impulseATR: 0, impulseVolumeRatio: 0, barsSinceImpulse: 0
    });
  }

  private invalidate(symbol: string, reason: string): null {
    const setup = this.setups.get(symbol);
    this.debug(symbol, `❌ INVALIDATED: ${reason}`, setup);
    if (setup) setup.state = SetupState.INVALIDATED;
    return null;
  }

  private debug(symbol: string, label: string, data?: any) {
    logger.debug('STRATEGY', `${symbol} | ${label}`, data);
  }

  private info(symbol: string, label: string, data?: any) {
    logger.info('STRATEGY', `${symbol} | ${label}`, data);
  }

  private getTickSize(symbol: string): number {
    return 0.01;
  }
}