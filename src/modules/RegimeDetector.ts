/**
 * Regime Detector
 * Responsibility: Determine current market regime (trending, ranging, volatile)
 * Different regimes require different strategies
 */

import { Candle, MarketRegime } from '../types';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';
import { Helpers } from '../utils/Helpers';

export class RegimeDetector {
  /**
   * Detect current market regime
   */
  public detect(candles: Candle[]): MarketRegime {
    if (candles.length < 50) {
      return MarketRegime.UNKNOWN;
    }

    // Calculate ADX (Average Directional Index) for trend strength
    const adx = this.calculateSimpleADX(candles);

    // Calculate volatility
    const volatility = this.calculateVolatility(candles);

    // Determine regime based on ADX and volatility
    return this.classifyRegime(adx, volatility);
  }

  /**
   * Simple ADX calculation
   * ADX > 25 = trending
   * ADX < 20 = ranging
   */
  private calculateSimpleADX(candles: Candle[], period: number = 14): number {
    if (candles.length < period * 2) return 0;

    const recentCandles = candles.slice(-period * 2);
    
    // Calculate +DM and -DM
    let plusDM = 0;
    let minusDM = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      const highDiff = recentCandles[i].high - recentCandles[i - 1].high;
      const lowDiff = recentCandles[i - 1].low - recentCandles[i].low;

      if (highDiff > lowDiff && highDiff > 0) {
        plusDM += highDiff;
      }
      if (lowDiff > highDiff && lowDiff > 0) {
        minusDM += lowDiff;
      }
    }

    // Calculate ATR for normalization
    const atrValues = TechnicalIndicators.atr(recentCandles, period);
    const avgATR = Helpers.average(atrValues);

    if (avgATR === 0) return 0;

    // Normalized directional indicators
    const plusDI = (plusDM / recentCandles.length) / avgATR * 100;
    const minusDI = (minusDM / recentCandles.length) / avgATR * 100;

    // DX (Directional Movement Index)
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;

    return isNaN(dx) ? 0 : dx;
  }

  /**
   * Calculate market volatility
   */
  private calculateVolatility(candles: Candle[]): number {
    if (candles.length < 20) return 0;

    const closes = candles.map(c => c.close);
    const returns: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const returnPct = (closes[i] - closes[i - 1]) / closes[i - 1];
      returns.push(returnPct);
    }

    // Standard deviation of returns
    return TechnicalIndicators.stdDev(returns) * 100; // As percentage
  }

  /**
   * Classify regime based on ADX and volatility
   */
  private classifyRegime(adx: number, volatility: number): MarketRegime {
    // High ADX = trending market
    if (adx > 25) {
      return MarketRegime.TRENDING;
    }

    // Low ADX + high volatility = volatile/choppy
    if (adx < 20 && volatility > 3) {
      return MarketRegime.VOLATILE;
    }

    // Low ADX + low volatility = ranging
    if (adx < 20 && volatility <= 3) {
      return MarketRegime.RANGING;
    }

    return MarketRegime.UNKNOWN;
  }

  /**
   * Check if regime is suitable for trend-following strategy
   */
  public isTrendingRegime(regime: MarketRegime): boolean {
    return regime === MarketRegime.TRENDING;
  }

  /**
   * Check if regime is suitable for mean-reversion strategy
   */
  public isRangingRegime(regime: MarketRegime): boolean {
    return regime === MarketRegime.RANGING;
  }

  /**
   * Check if we should avoid trading
   */
  public shouldAvoidTrading(regime: MarketRegime): boolean {
    return regime === MarketRegime.VOLATILE || regime === MarketRegime.UNKNOWN;
  }

  /**
   * Get regime strength score (0-1)
   */
  public getRegimeStrength(candles: Candle[], regime: MarketRegime): number {
    const adx = this.calculateSimpleADX(candles);

    switch (regime) {
      case MarketRegime.TRENDING:
        // Stronger trend = higher ADX
        return Math.min(adx / 50, 1);
      
      case MarketRegime.RANGING:
        // Stronger range = lower ADX
        return Math.min((30 - adx) / 30, 1);
      
      case MarketRegime.VOLATILE:
        // Based on volatility
        const volatility = this.calculateVolatility(candles);
        return Math.min(volatility / 5, 1);
      
      default:
        return 0;
    }
  }

  /**
   * Get regime summary
   */
  public getRegimeSummary(regime: MarketRegime, candles: Candle[]): string {
    const regimeEmoji = {
      [MarketRegime.TRENDING]: '📈',
      [MarketRegime.RANGING]: '↔️',
      [MarketRegime.VOLATILE]: '⚡',
      [MarketRegime.UNKNOWN]: '❓'
    };

    const strength = this.getRegimeStrength(candles, regime);
    const adx = this.calculateSimpleADX(candles);

    return `${regimeEmoji[regime]} ${regime} | ADX: ${adx.toFixed(1)} | Strength: ${(strength * 100).toFixed(0)}%`;
  }
}