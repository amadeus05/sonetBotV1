/**
 * Pullback Scanner - FIXED VERSION
 * Detects pullbacks based on PRICE ACTION, not EMA proximity
 */

import { Candle, PullbackAnalysis, TrendDirection, TrendAnalysis } from '../types';
import { config } from '../config/ConfigManager';

export class PullbackScanner {
  /**
   * Scan for pullback based on recent price action
   * NEW LOGIC: Detect when price moves against the trend (any retracement)
   */
  public scan(candles: Candle[], trend: TrendAnalysis): PullbackAnalysis {
    if (!trend.isStrong || trend.direction === TrendDirection.NEUTRAL) {
      return this.getNoPullback();
    }

    if (candles.length < 10) {
      return this.getNoPullback();
    }

    // Look at last 10 candles for a retracement pattern
    const recentCandles = candles.slice(-10);
    const isLong = trend.direction === TrendDirection.BULLISH;

    // Find recent swing high/low (pullback extreme)
    let pullbackLevel = 0;
    let occurred = false;

    if (isLong) {
      // In uptrend, look for a swing low (retracement down)
      const lows = recentCandles.map(c => c.low);
      pullbackLevel = Math.min(...lows);
      
      // Occurred if recent low is below the EMA (showing retracement)
      const currentPrice = recentCandles[recentCandles.length - 1].close;
      occurred = pullbackLevel < trend.emaFast && currentPrice >= pullbackLevel * 0.998;
      
    } else {
      // In downtrend, look for a swing high (retracement up)
      const highs = recentCandles.map(c => c.high);
      pullbackLevel = Math.max(...highs);
      
      // Occurred if recent high is above the EMA (showing retracement)
      const currentPrice = recentCandles[recentCandles.length - 1].close;
      occurred = pullbackLevel > trend.emaFast && currentPrice <= pullbackLevel * 1.002;
    }

    // Calculate distance from EMA
    const distancePercent = Math.abs((pullbackLevel - trend.emaFast) / trend.emaFast) * 100;

    // Validate: pullback should be within reasonable distance from EMA
    const maxDistance = config.getStrategyConfig().maxPullbackDistance * 100;
    const isValid = occurred && distancePercent <= maxDistance;

    return {
      occurred,
      distanceFromEMA: distancePercent,
      level: pullbackLevel,
      isValid,
      low: isLong ? pullbackLevel : trend.emaFast,
      high: isLong ? trend.emaFast : pullbackLevel
    };
  }

  /**
   * Check if price is bouncing off the pullback level
   * SIMPLIFIED: Just check if last 2 candles show reversal
   */
  public isBouncing(
    candles: Candle[], 
    pullback: PullbackAnalysis, 
    trend: TrendDirection
  ): boolean {
    if (!pullback.occurred || candles.length < 3) return false;

    const recentCandles = candles.slice(-3);
    const prevCandle = recentCandles[1];
    const currentCandle = recentCandles[2];

    if (trend === TrendDirection.BULLISH) {
      // Bullish bounce: Current candle closing higher than previous
      const isGreen = currentCandle.close > currentCandle.open;
      const higherClose = currentCandle.close > prevCandle.close;
      return isGreen && higherClose;
      
    } else {
      // Bearish bounce: Current candle closing lower than previous
      const isRed = currentCandle.close < currentCandle.open;
      const lowerClose = currentCandle.close < prevCandle.close;
      return isRed && lowerClose;
    }
  }

  /**
   * Calculate pullback quality score (0-1)
   */
  public calculatePullbackScore(
    pullback: PullbackAnalysis,
    candles: Candle[],
    trend: TrendDirection
  ): number {
    if (!pullback.occurred || !pullback.isValid) return 0;

    let score = 0;

    // Factor 1: Distance from EMA (closer = better, but not too close)
    const idealDistance = 1.5; // ~1.5% from EMA is ideal
    const distanceDiff = Math.abs(pullback.distanceFromEMA - idealDistance);
    const distanceScore = Math.max(0, 1 - (distanceDiff / 2));
    score += distanceScore * 0.5;

    // Factor 2: Bounce confirmation
    if (this.isBouncing(candles, pullback, trend)) {
      score += 0.3;
    }

    // Factor 3: Volume on bounce
    if (candles.length >= 2) {
      const currentVolume = candles[candles.length - 1].volume;
      const avgVolume = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
      if (currentVolume > avgVolume * 1.1) {
        score += 0.2;
      }
    }

    return Math.min(score, 1);
  }

  /**
   * Check if pullback is too deep (might be reversal)
   */
  public isTooDeep(pullback: PullbackAnalysis, trend: TrendAnalysis): boolean {
    if (!pullback.occurred) return false;
    
    const maxDepth = config.getStrategyConfig().maxPullbackDistance * 100 * 1.5;
    return pullback.distanceFromEMA > maxDepth;
  }

  /**
   * Get no pullback result
   */
  private getNoPullback(): PullbackAnalysis {
    return {
      occurred: false,
      distanceFromEMA: 100,
      level: 0,
      isValid: false,
      low: 0,
      high: 0
    };
  }

  /**
   * Get pullback summary
   */
  public getPullbackSummary(pullback: PullbackAnalysis, trend: TrendDirection): string {
    if (!pullback.occurred) {
      return '⏳ Waiting for pullback...';
    }

    if (!pullback.isValid) {
      return '❌ Pullback invalid (too far from structure)';
    }

    const emoji = trend === TrendDirection.BULLISH ? '🎯' : '🔻';
    return `${emoji} Pullback detected @ ${pullback.level.toFixed(2)} (${pullback.distanceFromEMA.toFixed(2)}% from EMA)`;
  }
}