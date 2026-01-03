/**
 * Pullback Scanner
 * Responsibility: Detect pullbacks to key levels (EMA, support/resistance)
 * This is where we want to ENTER after momentum spike
 */

import { Candle, PullbackAnalysis, TrendDirection, TrendAnalysis } from '../types';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';
import { config } from '../config/ConfigManager';
import { Helpers } from '../utils/Helpers';

export class PullbackScanner {
  /**
   * Scan for pullback opportunities
   */
  public scan(candles: Candle[], trend: TrendAnalysis): PullbackAnalysis {
    const strategyConfig = config.getStrategyConfig();

    if (!trend.isStrong || trend.direction === TrendDirection.NEUTRAL) {
      return this.getNoPullback();
    }

    const currentPrice = candles[candles.length - 1].close;

    // Check pullback to EMA
    if (strategyConfig.pullbackToEMA) {
      return this.scanEMAPullback(currentPrice, trend, strategyConfig);
    }

    // Check pullback to support/resistance
    return this.scanLevelPullback(candles, trend);
  }

  /**
   * Scan for pullback to EMA
   */
  private scanEMAPullback(
    currentPrice: number,
    trend: TrendAnalysis,
    config: any
  ): PullbackAnalysis {
    const targetEMA = trend.emaFast; // Use fast EMA as pullback level

    // Calculate distance from EMA
    const distancePercent = Math.abs((currentPrice - targetEMA) / targetEMA) * 100;

    let occurred = false;
    let isValid = false;

    if (trend.direction === TrendDirection.BULLISH) {
      // In bullish trend, pullback = price near or below fast EMA
      occurred = currentPrice <= targetEMA * 1.005; // Within 0.5% of EMA
      isValid = occurred && distancePercent <= (config.maxPullbackDistance * 100);
    } else if (trend.direction === TrendDirection.BEARISH) {
      // In bearish trend, pullback = price near or above fast EMA
      occurred = currentPrice >= targetEMA * 0.995; // Within 0.5% of EMA
      isValid = occurred && distancePercent <= (config.maxPullbackDistance * 100);
    }

    return {
      occurred,
      distanceFromEMA: distancePercent,
      level: targetEMA,
      isValid,
      low: targetEMA,    // Use EMA as default low/high
      high: targetEMA
    };
  }

  /**
   * Scan for pullback to support/resistance levels
   */
  private scanLevelPullback(candles: Candle[], trend: TrendAnalysis): PullbackAnalysis {
    const pivots = TechnicalIndicators.findPivots(candles, 5, 5);
    const currentPrice = candles[candles.length - 1].close;

    let level = 0;
    let occurred = false;
    let distanceFromEMA = 0;
    let lowPrice = currentPrice;
    let highPrice = currentPrice;

    if (trend.direction === TrendDirection.BULLISH) {
      // Find nearest support level (pivot low)
      const supportLevels = pivots.lows.filter(low => low < currentPrice);
      if (supportLevels.length > 0) {
        level = Math.max(...supportLevels); // Highest support below current price
        const distance = ((currentPrice - level) / level) * 100;
        occurred = distance <= 2; // Within 2% of support
        distanceFromEMA = distance;
        lowPrice = level;
        highPrice = currentPrice;
      }
    } else if (trend.direction === TrendDirection.BEARISH) {
      // Find nearest resistance level (pivot high)
      const resistanceLevels = pivots.highs.filter(high => high > currentPrice);
      if (resistanceLevels.length > 0) {
        level = Math.min(...resistanceLevels); // Lowest resistance above current price
        const distance = ((level - currentPrice) / currentPrice) * 100;
        occurred = distance <= 2; // Within 2% of resistance
        distanceFromEMA = distance;
        lowPrice = currentPrice;
        highPrice = level;
      }
    }

    return {
      occurred,
      distanceFromEMA,
      level,
      isValid: occurred && level > 0,
      low: lowPrice,
      high: highPrice
    };
  }

  /**
   * Check if price is bouncing off the pullback level
   */
  public isBouncing(candles: Candle[], pullback: PullbackAnalysis, trend: TrendDirection): boolean {
    if (!pullback.occurred || candles.length < 3) return false;

    const recentCandles = candles.slice(-3);
    const currentCandle = recentCandles[2];
    const prevCandle = recentCandles[1];

    if (trend === TrendDirection.BULLISH) {
      // Bullish bounce: 
      // - Previous candle touched or went below level
      // - Current candle is closing above level and above previous close
      const touchedLevel = prevCandle.low <= pullback.level * 1.01;
      const bouncingUp = currentCandle.close > prevCandle.close &&
        currentCandle.close > pullback.level;

      return touchedLevel && bouncingUp;
    } else if (trend === TrendDirection.BEARISH) {
      // Bearish bounce:
      // - Previous candle touched or went above level
      // - Current candle is closing below level and below previous close
      const touchedLevel = prevCandle.high >= pullback.level * 0.99;
      const bouncingDown = currentCandle.close < prevCandle.close &&
        currentCandle.close < pullback.level;

      return touchedLevel && bouncingDown;
    }

    return false;
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

    // Factor 1: Distance from level (closer = better)
    const distanceScore = 1 - Math.min(pullback.distanceFromEMA / 3, 1);
    score += distanceScore * 0.4;

    // Factor 2: Bounce confirmation
    if (this.isBouncing(candles, pullback, trend)) {
      score += 0.4;
    }

    // Factor 3: Volume on bounce
    if (candles.length >= 2) {
      const currentVolume = candles[candles.length - 1].volume;
      const prevVolume = candles[candles.length - 2].volume;
      if (currentVolume > prevVolume * 1.2) {
        score += 0.2; // Volume increasing on bounce
      }
    }

    return Math.min(score, 1);
  }

  /**
   * Check if pullback is too deep (might be reversal, not pullback)
   */
  public isTooDeep(pullback: PullbackAnalysis, trend: TrendAnalysis): boolean {
    if (!pullback.occurred) return false;

    // If price has moved too far from the trend EMA, it might be reversing
    const maxDeepness = config.getStrategyConfig().maxPullbackDistance * 100;

    return pullback.distanceFromEMA > maxDeepness * 1.5;
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
      return '❌ Pullback too deep';
    }

    const emoji = trend === TrendDirection.BULLISH ? '🎯' : '🔻';
    return `${emoji} Pullback to ${Helpers.formatNumber(pullback.level, 4)} (${pullback.distanceFromEMA.toFixed(2)}% away)`;
  }
}