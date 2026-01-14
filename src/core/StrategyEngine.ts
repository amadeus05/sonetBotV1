import { Candle, MarketData, TradingSignal, SignalType, TrendDirection } from '../types';
import { RiskManager } from './RiskManager';
import { logger } from '../services/Logger';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';

// =========================
// RR-DRIVEN MOMENTUM CONTINUATION (5m)
// Core idea: momentum continuation AFTER shallow pullbacks (not reversals)
// =========================

enum SetupState {
  IDLE,
  HAVE_IMPULSE,
  IN_PULLBACK,
}

interface RRSetup {
  state: SetupState;
  direction: TrendDirection;
  barsSinceImpulse: number;
  impulseHigh: number;
  impulseLow: number;
  impulseATR: number;
  impulseVolumeRatio: number;
  pullbackBars: number;
  pullbackHigh: number;
  pullbackLow: number;
}

// --- STRICT CONSTANTS (per user constraints) ---
const ATR_PERIOD = 14;
const ATR_AVG_PERIOD = 50;
const VOLUME_SMA_PERIOD = 20;

const ATR_FILTER_MULT = 1.6;     // ATR(14) >= 120% of ATR_SMA50
const VOLUME_FILTER_MULT = 0.7;  // Volume >= 0.9 * SMA20(volume) (relaxed for continuation)

const IMPULSE_BODY_ATR = 1.2;    // Multi-candle body sum >= 0.9 * ATR
const IMPULSE_LOOKBACK = 3;      // Check 2-4 candles BEFORE last

const PULLBACK_MAX_DEPTH_ATR = 0.5; // max depth <= 0.5 ATR
const PULLBACK_MAX_BARS = 5;        // duration <= 5 candles

// Tight SL: 0.6–0.8 ATR (use 0.7 default)
const SL_ATR_MULT = 2.0;
// Fixed RR
const FIXED_RR = 4.0;
// Partial exit
const TP1_R = 2.0;
const TP1_FRACTION = 0.2;

export class StrategyEngine {
  private riskManager: RiskManager;
  private setups: Map<string, RRSetup> = new Map();

  constructor(riskManager: RiskManager) {
    this.riskManager = riskManager;
    logger.info('StrategyEngine', 'Initialized (RR-Driven Momentum Continuation v1.0)');
  }

  public async analyze(marketData: MarketData): Promise<TradingSignal | null> {
    const { symbol, candles } = marketData;
    if (!candles || candles.length < 260) {
      // console.log('[REJECT]', JSON.stringify({ reason: 'WARMUP', symbol, candleCount: candles?.length }));
      return null; // warm-up for EMA200 + ATR averages
    }

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] ?? last;

    const setup = this.getOrInitSetup(symbol);

    // --- Trend filter (EMA50/EMA200) ---
    const closes = candles.map(c => c.close);
    const ema50 = TechnicalIndicators.ema(closes, 50);
    const ema200 = TechnicalIndicators.ema(closes, 200);
    if (ema50.length === 0 || ema200.length === 0) {
      // console.log('[REJECT]', JSON.stringify({ reason: 'EMA_FAIL', symbol }));
      return null;
    }

    const ema50v = ema50[ema50.length - 1];
    const ema200v = ema200[ema200.length - 1];

    const trendDir =
      ema50v > ema200v ? TrendDirection.BULLISH :
        ema50v < ema200v ? TrendDirection.BEARISH :
          TrendDirection.NEUTRAL;

    // --- Market conditions filter (ATR + Volume) ---
    const atrSeries = TechnicalIndicators.atr(candles, ATR_PERIOD);
    if (atrSeries.length < ATR_AVG_PERIOD) {
      this.resetSetup(symbol);
      // console.log('[REJECT]', JSON.stringify({ reason: 'ATR_SERIES_SHORT', symbol }));
      return null;
    }

    const currentATR = atrSeries[atrSeries.length - 1];
    const atrAvg50 = TechnicalIndicators.sma(atrSeries.slice(-ATR_AVG_PERIOD), ATR_AVG_PERIOD)[0];

    const volSma = TechnicalIndicators.volumeAverage(candles, VOLUME_SMA_PERIOD);
    if (volSma.length === 0) {
      this.resetSetup(symbol);
      // console.log('[REJECT]', JSON.stringify({ reason: 'VOL_SMA_FAIL', symbol }));
      return null;
    }

    const volSma20 = volSma[volSma.length - 1];
    const volRatio = volSma20 > 0 ? (last.volume / volSma20) : 0;

    const atrOk = currentATR >= (atrAvg50 * ATR_FILTER_MULT);
    const volOk = volRatio >= VOLUME_FILTER_MULT;
    const regimeOk = atrOk && volOk;

    // Forbidden: holding during low volatility / without volume expansion
    // We invalidate setups if regime filters fail.
    if (!regimeOk) {
      if (setup.state !== SetupState.IDLE) {
        this.debug(symbol, `INVALIDATED: FILTER_FAIL atrOk=${atrOk} volOk=${volOk}`);
      }
      // console.log('[REJECT]', JSON.stringify({
      //   reason: 'REGIME_FAIL',
      //   symbol,
      //   atrOk,
      //   volOk,
      //   atr: currentATR.toFixed(4),
      //   atrAvg: atrAvg50.toFixed(4),
      //   volRatio: volRatio.toFixed(2),
      // }));
      this.resetSetup(symbol);
      return null;
    }

    // If trend is neutral -> no trades, invalidate any setups.
    if (trendDir === TrendDirection.NEUTRAL) {
      // console.log('[REJECT]', JSON.stringify({
      //   reason: 'TREND_NEUTRAL',
      //   symbol,
      //   regimeOk,
      //   atr: currentATR.toFixed(4),
      //   atrAvg: atrAvg50.toFixed(4),
      //   volRatio: volRatio.toFixed(2),
      // }));
      this.resetSetup(symbol);
      return null;
    }

    switch (setup.state) {
      case SetupState.IDLE: {
        // Multi-candle impulse detection (2-4 candles BEFORE last, not the last itself)
        const impulseResult = this.detectImpulse(candles, currentATR, trendDir, IMPULSE_LOOKBACK);
        if (!impulseResult.found) {
          // console.log('[REJECT]', JSON.stringify({
          //   reason: 'NO_IMPULSE',
          //   symbol,
          //   state: 'IDLE',
          //   impulseOk: false,
          //   regimeOk,
          //   atr: currentATR.toFixed(4),
          //   volRatio: volRatio.toFixed(2),
          // }));
          return null;
        }

        setup.state = SetupState.HAVE_IMPULSE;
        setup.direction = trendDir;
        setup.barsSinceImpulse = 0;
        setup.impulseHigh = impulseResult.high;
        setup.impulseLow = impulseResult.low;
        setup.impulseATR = currentATR;
        setup.impulseVolumeRatio = impulseResult.avgVolRatio;
        setup.pullbackBars = 0;
        setup.pullbackHigh = 0;
        setup.pullbackLow = 0;

        this.debug(symbol, 'IMPULSE DETECTED', {
          dir: trendDir,
          atr: currentATR,
          volRatio,
        });

        return null;
      }

      case SetupState.HAVE_IMPULSE: {
        // Pullback must start soon; otherwise edge decays.
        setup.barsSinceImpulse++;
        if (setup.barsSinceImpulse > PULLBACK_MAX_BARS) {
          // console.log('[REJECT]', JSON.stringify({
          //   reason: 'PULLBACK_TIMEOUT',
          //   symbol,
          //   state: 'HAVE_IMPULSE',
          //   barsSinceImpulse: setup.barsSinceImpulse,
          //   regimeOk,
          // }));
          this.resetSetup(symbol);
          return null;
        }

        const pullbackOk = this.isPullbackStarting(last, prev, setup.direction);
        if (!pullbackOk) {
          // console.log('[REJECT]', JSON.stringify({
          //   reason: 'NO_PULLBACK_START',
          //   symbol,
          //   state: 'HAVE_IMPULSE',
          //   pullbackOk: false,
          //   regimeOk,
          // }));
          return null;
        }

        setup.state = SetupState.IN_PULLBACK;
        setup.pullbackBars = 1;
        setup.pullbackHigh = last.high;
        setup.pullbackLow = last.low;

        // depth check immediately
        if (!this.isPullbackDepthOk(setup)) {
          this.resetSetup(symbol);
        }

        return null;
      }

      case SetupState.IN_PULLBACK: {
        // Entry on continuation CLOSE above pullback high (mirror for short)
        const canEnter = this.isContinuationBreakout(last, setup);
        if (canEnter) {
          const signal = this.buildSignal(symbol, last.close, setup);
          const sizing = this.riskManager.calculatePositionSize(signal, candles);
          const sizedSignal = { ...signal, positionSize: sizing.size };

          const validation = this.riskManager.validateSignal(sizedSignal);
          if (!validation.valid) {
            this.debug(symbol, `RISK_REJECTED: ${validation.reason}`);
            // console.log('[REJECT]', JSON.stringify({
            //   reason: 'RISK_REJECTED',
            //   symbol,
            //   state: 'IN_PULLBACK',
            //   riskReason: validation.reason,
            //   regimeOk,
            // }));
            this.resetSetup(symbol);
            return null;
          }

          this.info(symbol, '🎯 TRADE SIGNAL (RR-driven)', sizedSignal);
          this.resetSetup(symbol);
          return sizedSignal;
        }

        // Still in pullback: update bounds and validate constraints
        setup.pullbackBars++;
        setup.pullbackHigh = Math.max(setup.pullbackHigh, last.high);
        setup.pullbackLow = Math.min(setup.pullbackLow, last.low);

        if (setup.pullbackBars > PULLBACK_MAX_BARS) {
          // console.log('[REJECT]', JSON.stringify({
          //   reason: 'PULLBACK_TOO_LONG',
          //   symbol,
          //   state: 'IN_PULLBACK',
          //   pullbackBars: setup.pullbackBars,
          //   regimeOk,
          // }));
          this.resetSetup(symbol);
          return null;
        }

        if (!this.isPullbackDepthOk(setup)) {
          // console.log('[REJECT]', JSON.stringify({
          //   reason: 'PULLBACK_TOO_DEEP',
          //   symbol,
          //   state: 'IN_PULLBACK',
          //   regimeOk,
          // }));
          this.resetSetup(symbol);
          return null;
        }

        // console.log('[REJECT]', JSON.stringify({
        //   reason: 'NO_BREAKOUT',
        //   symbol,
        //   state: 'IN_PULLBACK',
        //   pullbackBars: setup.pullbackBars,
        //   regimeOk,
        // }));
        return null;
      }
    }

    console.log('[REJECT]', JSON.stringify({ reason: 'FALLTHROUGH', symbol }));
    return null;
  }

  /**
   * Multi-candle impulse detection.
   * Looks at 2-4 candles BEFORE the last candle (which may be a pullback).
   * Sums directional body to detect sustained momentum.
   */
  private detectImpulse(
    candles: Candle[],
    atr: number,
    trendDir: TrendDirection,
    lookback: number = 3
  ): { found: boolean; high: number; low: number; avgVolRatio: number } {
    const n = candles.length;
    if (n < lookback + 1) {
      return { found: false, high: 0, low: 0, avgVolRatio: 0 };
    }

    // Take lookback candles BEFORE the last one (last may be pullback)
    const startIdx = n - lookback - 1;
    const endIdx = n - 1; // exclusive, so we skip the last candle
    const impulseCandles = candles.slice(startIdx, endIdx);

    // Calculate directional body sum (positive for bullish, negative for bearish)
    let totalDirectionalBody = 0;
    let windowHigh = -Infinity;
    let windowLow = Infinity;
    let totalVolume = 0;

    for (const c of impulseCandles) {
      totalDirectionalBody += (c.close - c.open); // directional, not abs
      windowHigh = Math.max(windowHigh, c.high);
      windowLow = Math.min(windowLow, c.low);
      totalVolume += c.volume;
    }

    const absBody = Math.abs(totalDirectionalBody);
    const bodyOk = absBody >= atr * IMPULSE_BODY_ATR;

    // Direction must match trend
    const directionOk =
      (trendDir === TrendDirection.BULLISH && totalDirectionalBody > 0) ||
      (trendDir === TrendDirection.BEARISH && totalDirectionalBody < 0);

    // Calculate average volume ratio for the impulse window
    const avgVolume = totalVolume / impulseCandles.length;
    const volSma = TechnicalIndicators.volumeAverage(candles.slice(0, endIdx), VOLUME_SMA_PERIOD);
    const volSmaValue = volSma.length > 0 ? volSma[volSma.length - 1] : avgVolume;
    const avgVolRatio = volSmaValue > 0 ? avgVolume / volSmaValue : 0;

    if (bodyOk && directionOk) {
      return { found: true, high: windowHigh, low: windowLow, avgVolRatio };
    }

    return { found: false, high: 0, low: 0, avgVolRatio: 0 };
  }

  private isPullbackStarting(candle: Candle, prev: Candle, dir: TrendDirection): boolean {
    if (dir === TrendDirection.BULLISH) {
      // pullback: at least some counter-move pressure
      return (candle.close < prev.close) || (candle.close < candle.open);
    }
    if (dir === TrendDirection.BEARISH) {
      return (candle.close > prev.close) || (candle.close > candle.open);
    }
    return false;
  }

  private isPullbackDepthOk(setup: RRSetup): boolean {
    if (setup.direction === TrendDirection.BULLISH) {
      const depth = setup.impulseHigh - setup.pullbackLow;
      return depth <= (setup.impulseATR * PULLBACK_MAX_DEPTH_ATR);
    }
    if (setup.direction === TrendDirection.BEARISH) {
      const depth = setup.pullbackHigh - setup.impulseLow;
      return depth <= (setup.impulseATR * PULLBACK_MAX_DEPTH_ATR);
    }
    return false;
  }

  private isContinuationBreakout(candle: Candle, setup: RRSetup): boolean {
    if (setup.pullbackBars < 1) return false;

    if (setup.direction === TrendDirection.BULLISH) {
      return candle.close > setup.pullbackHigh && candle.close > candle.open;
    }

    if (setup.direction === TrendDirection.BEARISH) {
      return candle.close < setup.pullbackLow && candle.close < candle.open;
    }

    return false;
  }

  private buildSignal(symbol: string, entryRefPrice: number, setup: RRSetup): TradingSignal {
    const isLong = setup.direction === TrendDirection.BULLISH;

    const stopDistance = setup.impulseATR * SL_ATR_MULT;
    const stopLoss = isLong ? entryRefPrice - stopDistance : entryRefPrice + stopDistance;
    const takeProfit = isLong
      ? entryRefPrice + (stopDistance * FIXED_RR)
      : entryRefPrice - (stopDistance * FIXED_RR);

    const signal: TradingSignal = {
      symbol,
      type: isLong ? SignalType.LONG : SignalType.SHORT,
      entry: entryRefPrice, // reference: close of continuation candle; execution happens next bar open in backtest
      stopLoss,
      takeProfit,
      positionSize: 0,
      confidence: 1,
      timestamp: Date.now(),
      tags: ['rr_driven', 'impulse_pullback_continuation', 'tp1_70pct', 'trail_be'],
      metadata: {
        ...setup,
        stopDistance,
        rr: FIXED_RR,
        tp1R: TP1_R,
        tp1Fraction: TP1_FRACTION,
        trailingDistance: stopDistance, // volatility-based
      }
    };

    return signal;
  }

  private getOrInitSetup(symbol: string): RRSetup {
    let setup = this.setups.get(symbol);
    if (!setup) {
      setup = {
        state: SetupState.IDLE,
        direction: TrendDirection.NEUTRAL,
        barsSinceImpulse: 0,
        impulseHigh: 0,
        impulseLow: 0,
        impulseATR: 0,
        impulseVolumeRatio: 0,
        pullbackBars: 0,
        pullbackHigh: 0,
        pullbackLow: 0,
      };
      this.setups.set(symbol, setup);
    }
    return setup;
  }

  private resetSetup(symbol: string) {
    this.setups.set(symbol, {
      state: SetupState.IDLE,
      direction: TrendDirection.NEUTRAL,
      barsSinceImpulse: 0,
      impulseHigh: 0,
      impulseLow: 0,
      impulseATR: 0,
      impulseVolumeRatio: 0,
      pullbackBars: 0,
      pullbackHigh: 0,
      pullbackLow: 0,
    });
  }

  private debug(symbol: string, label: string, data?: any) {
    logger.debug('STRATEGY', `${symbol} | ${label}`, data);
  }

  private info(symbol: string, label: string, data?: any) {
    logger.info('STRATEGY', `${symbol} | ${label}`, data);
  }
}