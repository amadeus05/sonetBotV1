/**
 * Regime Detector
 * Responsibility: Determine current market regime (trending, ranging, volatile)
 * Different regimes require different strategies
 */

import { Candle, MarketRegime } from '../types';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';

// Константы периодов для индикаторов
const ADX_PERIOD = 14;
const VOLATILITY_PERIOD = 20;
// Минимально необходимое количество свечей:
// Для стабильного ADX нужно больше данных для сходимости EMA (обычно period * 3 или 4 дает лучший результат)
// Но минимум period * 2 достаточен для старта расчета.
const MIN_CANDLES_REQUIRED = Math.max(ADX_PERIOD * 2, VOLATILITY_PERIOD);

export class RegimeDetector {
  /**
   * Detect current market regime
   */
  public detect(candles: Candle[]): MarketRegime {
    if (candles.length < MIN_CANDLES_REQUIRED) {
      return MarketRegime.UNKNOWN;
    }

    // Calculate standard Wilder's ADX
    const adx = this.calculateStandardADX(candles, ADX_PERIOD);

    // Calculate volatility
    const volatility = this.calculateVolatility(candles, VOLATILITY_PERIOD);

    // Determine regime based on ADX and volatility
    return this.classifyRegime(adx, volatility);
  }

  /**
   * Standard Wilder's ADX Calculation
   * Implements the full algorithm:
   * 1. TR, +DM, -DM
   * 2. Smoothed TR, +DM, -DM (Wilder's Smoothing)
   * 3. +DI, -DI
   * 4. DX
   * 5. ADX (Smoothed DX)
   */
  private calculateStandardADX(candles: Candle[], period: number): number {
    if (candles.length < period * 2) return 0;

    const trs: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    // 1. Calculate Raw TR, +DM, -DM
    for (let i = 1; i < candles.length; i++) {
      const curr = candles[i];
      const prev = candles[i - 1];

      // True Range
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trs.push(tr);

      // Directional Movement
      const up = curr.high - prev.high;
      const down = prev.low - curr.low;

      let plusDM = 0;
      let minusDM = 0;

      if (up > down && up > 0) {
        plusDM = up;
      }
      if (down > up && down > 0) {
        minusDM = down;
      }

      plusDMs.push(plusDM);
      minusDMs.push(minusDM);
    }

    // 2. Initial Smoothing (First value is simple sum)
    let smoothTR = 0;
    let smoothPlusDM = 0;
    let smoothMinusDM = 0;

    for (let i = 0; i < period; i++) {
      smoothTR += trs[i];
      smoothPlusDM += plusDMs[i];
      smoothMinusDM += minusDMs[i];
    }

    // Calculate first DX to start the ADX smoothing chain
    
    const dxList: number[] = [];

    // Helper to calculate DX from smoothed components
    const calcDX = (pDM: number, mDM: number, tr: number): number => {
      if (tr === 0) return 0;
      const pDI = (pDM / tr) * 100;
      const mDI = (mDM / tr) * 100;
      const sum = pDI + mDI;
      return sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100;
    };

    // Push first DX
    dxList.push(calcDX(smoothPlusDM, smoothMinusDM, smoothTR));

    // 3. Calculate rolling Smoothed TR, +/-DM and subsequent DXs
    for (let i = period; i < trs.length; i++) {
      const currentTR = trs[i];
      const currentPlusDM = plusDMs[i];
      const currentMinusDM = minusDMs[i];

      // Wilder's Smoothing formula
      smoothTR = smoothTR - (smoothTR / period) + currentTR;
      smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + currentPlusDM;
      smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + currentMinusDM;

      dxList.push(calcDX(smoothPlusDM, smoothMinusDM, smoothTR));
    }

    // 4. Calculate ADX (Smoothing the DX values)
    if (dxList.length < period) return dxList[dxList.length - 1];

    // First ADX is average of first 'period' DX values
    let adx = dxList.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

    // Smoothing for the rest
    for (let i = period; i < dxList.length; i++) {
      adx = ((adx * (period - 1)) + dxList[i]) / period;
    }

    return adx;
  }

  /**
   * Calculate market volatility using a rolling window
   * Now strictly uses only the last 'period' candles to avoid regime stickiness.
   */
  private calculateVolatility(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0;

    // ИСПРАВЛЕНИЕ: Сначала берем срез последних N свечей, а не мапим весь массив.
    // Это гарантирует расчет волатильности только для локального окна.
    const recentCandles = candles.slice(-period);
    const closes = recentCandles.map(c => c.close);
    
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
    const adx = this.calculateStandardADX(candles, ADX_PERIOD);

    switch (regime) {
      case MarketRegime.TRENDING:
        // Stronger trend = higher ADX
        return Math.min(adx / 50, 1);
      
      case MarketRegime.RANGING:
        // Stronger range = lower ADX
        return Math.min((30 - adx) / 30, 1);
      
      case MarketRegime.VOLATILE:
        // Based on volatility
        const volatility = this.calculateVolatility(candles, VOLATILITY_PERIOD);
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
    const adx = this.calculateStandardADX(candles, ADX_PERIOD);

    return `${regimeEmoji[regime]} ${regime} | ADX: ${adx.toFixed(1)} | Strength: ${(strength * 100).toFixed(0)}%`;
  }
}