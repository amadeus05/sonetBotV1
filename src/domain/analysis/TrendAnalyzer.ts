/**
 * Trend Analyzer (Institutional Grade)
 * Responsibility: Determine market trend direction and QUALITY strength
 * UPDATED based on Pro Feedback:
 * 1. Overextension penalty (don't buy tops)
 * 2. Candle quality check (ignore doji/noise)
 * 3. Dynamic structure lookback
 * 4. Regime integration
 */

import { injectable, inject } from 'inversify';
import { Candle, TrendDirection, TrendAnalysis, MarketRegime } from '../../types';
import { IIndicators } from '../interfaces/IIndicators';
import { Candle as DomainCandle } from '../../domain/entities/Candle';
import { TYPES } from '../../di/types';
import { config } from '../../infrastructure/config/ConfigService';

@injectable()
export class TrendAnalyzer {
  constructor(
    @inject(TYPES.IIndicators) private readonly indicators: IIndicators
  ) { }

  /**
   * Analyze trend using EMAs, price structure, and candle quality
   * @param regime (Optional) Pass current market regime for context-aware scoring
   */
  public analyze(candles: Candle[], regime?: MarketRegime): TrendAnalysis {
    const closes = candles.map(c => c.close);
    const strategyConfig = config.getStrategyConfig();

    // Calculate EMAs
    const emaFast = this.indicators.ema(closes, strategyConfig.emaFast);
    const emaSlow = this.indicators.ema(closes, strategyConfig.emaSlow);

    if (emaFast.length === 0 || emaSlow.length === 0) {
      return this.getNeutralTrend();
    }

    // Get latest values
    const currentEmaFast = emaFast[emaFast.length - 1];
    const currentEmaSlow = emaSlow[emaSlow.length - 1];
    const currentPrice = closes[closes.length - 1];

    // 1. Determine Trend Direction
    const direction = this.determineTrendDirection(
      currentPrice,
      currentEmaFast,
      currentEmaSlow
    );

    // 2. Calculate Trend Strength (The "Quality" Score)
    let strength = this.calculateTrendStrength(
      currentPrice,
      currentEmaFast,
      currentEmaSlow,
      candles,
      strategyConfig.emaSlow // Pass slow period for dynamic structure lookback
    );

    // 3. Regime Integration (Feedback Point #5)
    // Если режим известен и он НЕ трендовый, мы штрафуем силу тренда.
    // Это фильтрует ложные пробои во флете.
    if (regime && regime !== MarketRegime.TRENDING) {
      strength *= 0.5;
    }

    // 4. Simplified isStrong Logic (Feedback Point #4)
    // Убрали двойной фильтр (diffPercent && strength).
    // Теперь strength — это и есть главный показатель качества.
    const isStrong = strength > 0.6;

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

    // Neutral or transitioning (choppy)
    return TrendDirection.NEUTRAL;
  }

  /**
   * Calculate trend strength (0-1)
   * Higher value = stronger, healthier trend
   */
  private calculateTrendStrength(
    price: number,
    emaFast: number,
    emaSlow: number,
    candles: Candle[],
    emaSlowPeriod: number
  ): number {
    // Factor 1: EMA Separation (Trend Momentum)
    const emaDiff = Math.abs(emaFast - emaSlow);
    const emaDistance = (emaDiff / emaSlow) * 100;
    // Maximize score at 3% separation, beyond that doesn't add much value
    const distanceScore = Math.min(emaDistance / 3, 1);

    // Factor 2: Price Structure (Higher Highs / Lower Lows)
    // (Feedback Point #3: Dynamic Lookback)
    // Используем окно относительно медленной EMA, а не хардкод 20
    const structureLookback = Math.max(emaSlowPeriod, 20);
    // Convert to domain Candle entities for the interface
    const domainCandles = candles.map(c => new DomainCandle(
      c.timestamp, c.open, c.high, c.low, c.close, c.volume
    ));
    const trendStructure = this.indicators.detectTrendStructure(domainCandles, structureLookback);
    let structureScore = 0;

    const isBullish = emaFast > emaSlow;

    if (isBullish) {
      if (trendStructure.higherHighs && trendStructure.higherLows) structureScore = 1;
      else if (trendStructure.higherHighs || trendStructure.higherLows) structureScore = 0.5;
    } else {
      if (trendStructure.lowerHighs && trendStructure.lowerLows) structureScore = 1;
      else if (trendStructure.lowerHighs || trendStructure.lowerLows) structureScore = 0.5;
    }

    // Factor 3: Candle Quality (Conviction)
    // (Feedback Point #2: Better Candle Counting)
    const recentCandles = candles.slice(-10);
    let strongCandleCount = 0;

    for (const candle of recentCandles) {
      const body = Math.abs(candle.close - candle.open);
      const range = candle.high - candle.low;

      // Игнорируем Doji и шум. Считаем только свечи с телом > 50% от диапазона
      const isQualityCandle = range > 0 && (body / range) > 0.5;

      if (isQualityCandle) {
        const isCandleBullish = candle.close > candle.open;
        if (isCandleBullish === isBullish) {
          strongCandleCount++;
        }
      }
    }
    const consistencyScore = strongCandleCount / 10;

    // Weighted average of base factors
    let totalScore = (
      distanceScore * 0.4 +
      structureScore * 0.4 +
      consistencyScore * 0.2
    );

    // Factor 4: Overextension Penalty (The "Rubber Band" effect)
    // (Feedback Point #1: Price vs EMA distance)
    // Если цена слишком далеко от EMA, тренд истощен и опасен для входа.
    const priceDistancePct = (Math.abs(price - emaFast) / emaFast) * 100;

    // Если отклонение > 1.5%, начинаем штрафовать
    if (priceDistancePct > 1.5) {
      // Штраф растет линейно. При 4.5% отклонения штраф будет максимальным (1.0)
      const penalty = Math.min((priceDistancePct - 1.5) / 3, 1);
      totalScore *= (1 - penalty);
    }

    return Math.max(0, Math.min(totalScore, 1));
  }

  /**
   * Check if trend is in reversal phase
   */
  public isReversal(candles: Candle[], currentTrend: TrendDirection): boolean {
    if (candles.length < 50) return false;

    const closes = candles.map(c => c.close);
    const strategyConfig = config.getStrategyConfig();
    // Используем более быстрые настройки для детекции разворота
    const emaFast = this.indicators.ema(closes, strategyConfig.emaFast); // Было 20
    const emaSlow = this.indicators.ema(closes, strategyConfig.emaSlow); // Было 50

    // Check for EMA crossover
    if (currentTrend === TrendDirection.BULLISH) {
      return this.indicators.crossUnder(emaFast, emaSlow);
    } else if (currentTrend === TrendDirection.BEARISH) {
      return this.indicators.crossOver(emaFast, emaSlow);
    }

    return false;
  }

  private getNeutralTrend(): TrendAnalysis {
    return {
      direction: TrendDirection.NEUTRAL,
      strength: 0,
      emaFast: 0,
      emaSlow: 0,
      isStrong: false
    };
  }

  public getTrendSummary(trend: TrendAnalysis): string {
    const directionEmoji = {
      [TrendDirection.BULLISH]: '📈',
      [TrendDirection.BEARISH]: '📉',
      [TrendDirection.NEUTRAL]: '➡️'
    };

    // Описательная сила тренда
    let strengthDesc = 'WEAK';
    if (trend.strength > 0.8) strengthDesc = 'VERY STRONG';
    else if (trend.strength > 0.6) strengthDesc = 'STRONG';
    else if (trend.strength > 0.4) strengthDesc = 'MODERATE';

    return `${directionEmoji[trend.direction]} ${trend.direction} (${strengthDesc} ${(trend.strength * 100).toFixed(0)}%)`;
  }
}