/**
 * Trend Analyzer
 * Responsibility: Determine market trend direction and strength
 * Using EMA crossover and trend structure analysis
 */

import { Candle, TrendDirection, TrendAnalysis } from '../types';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';
import { config } from '../config/ConfigManager';

export class TrendAnalyzer {
  /**
   * Analyze trend using EMAs and price structure
   */
  public analyze(candles: Candle[]): TrendAnalysis {
    const closes = candles.map(c => c.close);
    const strategyConfig = config.getStrategyConfig();

    // Calculate EMAs
    const emaFast = TechnicalIndicators.ema(closes, strategyConfig.emaFast);
    const emaSlow = TechnicalIndicators.ema(closes, strategyConfig.emaSlow);

    if (emaFast.length === 0 || emaSlow.length === 0) {
      return this.getNeutralTrend();
    }

    // Get latest values
    const currentEmaFast = emaFast[emaFast.length - 1];
    const currentEmaSlow = emaSlow[emaSlow.length - 1];
    const currentPrice = closes[closes.length - 1];

    // Calculate trend direction
    const direction = this.determineTrendDirection(
      currentPrice,
      currentEmaFast,
      currentEmaSlow
    );

    // Calculate trend strength
    const strength = this.calculateTrendStrength(
      currentEmaFast,
      currentEmaSlow,
      candles
    );

    // Check if trend is strong enough
    const priceDiff = Math.abs(currentEmaFast - currentEmaSlow);
    const diffPercent = (priceDiff / currentEmaSlow) * 100;
    const isStrong = diffPercent >= (strategyConfig.minTrendStrength * 100) && strength > 0.5;

    return {
      direction,
      strength,
      emaFast: currentEmaFast,
      emaSlow: currentEmaSlow,
      isStrong
    };
  }

  /**
   * Determine trend direction based on EMAs and price
   */
  private determineTrendDirection(
    price: number,
    emaFast: number,
    emaSlow: number
  ): TrendDirection {
    // Strong bullish: price > fast EMA > slow EMA
    if (price > emaFast && emaFast > emaSlow) {
      return TrendDirection.BULLISH;
    }

    // Strong bearish: price < fast EMA < slow EMA
    if (price < emaFast && emaFast < emaSlow) {
      return TrendDirection.BEARISH;
    }

    // Neutral or transitioning
    return TrendDirection.NEUTRAL;
  }

  /**
   * Calculate trend strength (0-1)
   * Higher value = stronger trend
   */
  private calculateTrendStrength(
    emaFast: number,
    emaSlow: number,
    candles: Candle[]
  ): number {
    // Factor 1: Distance between EMAs
    const emaDiff = Math.abs(emaFast - emaSlow);
    const emaDistance = (emaDiff / emaSlow) * 100;
    const distanceScore = Math.min(emaDistance / 5, 1); // Max out at 5% difference

    // Factor 2: Price consistency (are we making HH/HL or LH/LL?)
    const trendStructure = TechnicalIndicators.detectTrendStructure(candles, 20);
    let structureScore = 0;

    if (emaFast > emaSlow) {
      // Bullish trend - check for HH and HL
      if (trendStructure.higherHighs && trendStructure.higherLows) {
        structureScore = 1;
      } else if (trendStructure.higherHighs || trendStructure.higherLows) {
        structureScore = 0.5;
      }
    } else {
      // Bearish trend - check for LH and LL
      if (trendStructure.lowerHighs && trendStructure.lowerLows) {
        structureScore = 1;
      } else if (trendStructure.lowerHighs || trendStructure.lowerLows) {
        structureScore = 0.5;
      }
    }

    // Factor 3: Consecutive candles in trend direction
    const recentCandles = candles.slice(-10);
    let consecutiveCount = 0;
    const isBullish = emaFast > emaSlow;

    for (const candle of recentCandles) {
      const candleBullish = candle.close > candle.open;
      if (candleBullish === isBullish) {
        consecutiveCount++;
      }
    }

    const consistencyScore = consecutiveCount / 10;

    // Weighted average of all factors
    const totalScore = (
      distanceScore * 0.4 +
      structureScore * 0.4 +
      consistencyScore * 0.2
    );

    return Math.min(totalScore, 1);
  }

  /**
   * Check if trend is in reversal phase
   */
  public isReversal(candles: Candle[], currentTrend: TrendDirection): boolean {
    if (candles.length < 50) return false;

    const closes = candles.map(c => c.close);
    const emaFast = TechnicalIndicators.ema(closes, 20);
    const emaSlow = TechnicalIndicators.ema(closes, 50);

    // Check for EMA crossover
    if (currentTrend === TrendDirection.BULLISH) {
      return TechnicalIndicators.crossUnder(emaFast, emaSlow);
    } else if (currentTrend === TrendDirection.BEARISH) {
      return TechnicalIndicators.crossOver(emaFast, emaSlow);
    }

    return false;
  }

  /**
   * Get neutral trend analysis
   */
  private getNeutralTrend(): TrendAnalysis {
    return {
      direction: TrendDirection.NEUTRAL,
      strength: 0,
      emaFast: 0,
      emaSlow: 0,
      isStrong: false
    };
  }

  /**
   * Get trend summary string
   */
  public getTrendSummary(trend: TrendAnalysis): string {
    const directionEmoji = {
      [TrendDirection.BULLISH]: '📈',
      [TrendDirection.BEARISH]: '📉',
      [TrendDirection.NEUTRAL]: '➡️'
    };

    const strengthDesc = trend.strength > 0.7 ? 'STRONG' :
                        trend.strength > 0.4 ? 'MODERATE' : 'WEAK';

    return `${directionEmoji[trend.direction]} ${trend.direction} (${strengthDesc} ${(trend.strength * 100).toFixed(0)}%)`;
  }
}