/**
 * Technical Indicators
 * Pure functions for calculating technical indicators
 */

import { Candle } from '../types';

export class TechnicalIndicators {
  /**
   * Calculate Simple Moving Average
   */
  public static sma(data: number[], period: number): number[] {
    const result: number[] = [];
    for (let i = period - 1; i < data.length; i++) {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
    return result;
  }

  /**
   * Calculate Exponential Moving Average
   */
  public static ema(data: number[], period: number): number[] {
    const result: number[] = [];
    const multiplier = 2 / (period + 1);

    // First EMA is SMA
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(ema);

    // Calculate rest of EMAs
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
      result.push(ema);
    }

    return result;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  public static rsi(prices: number[], period: number = 14): number[] {
    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const result: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    // Calculate initial average gain/loss
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;

    // Calculate RSI
    for (let i = period; i < changes.length; i++) {
      const rs = avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      result.push(rsi);

      // Update averages for next iteration
      const change = changes[i];
      avgGain = ((avgGain * (period - 1)) + (change > 0 ? change : 0)) / period;
      avgLoss = ((avgLoss * (period - 1)) + (change < 0 ? Math.abs(change) : 0)) / period;
    }

    return result;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  public static atr(candles: Candle[], period: number = 14): number[] {
    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // Calculate ATR using EMA of true ranges
    return this.ema(trueRanges, period);
  }

  /**
   * Calculate Bollinger Bands
   */
  public static bollingerBands(
    prices: number[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number[]; middle: number[]; lower: number[] } {
    const middle = this.sma(prices, period);
    const upper: number[] = [];
    const lower: number[] = [];

    for (let i = 0; i < middle.length; i++) {
      const slice = prices.slice(i, i + period);
      const mean = middle[i];
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      const std = Math.sqrt(variance);

      upper.push(mean + (stdDev * std));
      lower.push(mean - (stdDev * std));
    }

    return { upper, middle, lower };
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  public static macd(
    prices: number[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): { macd: number[]; signal: number[]; histogram: number[] } {
    const emaFast = this.ema(prices, fastPeriod);
    const emaSlow = this.ema(prices, slowPeriod);

    // MACD line
    const macdLine: number[] = [];
    const offset = slowPeriod - fastPeriod;
    for (let i = 0; i < emaSlow.length; i++) {
      macdLine.push(emaFast[i + offset] - emaSlow[i]);
    }

    // Signal line
    const signalLine = this.ema(macdLine, signalPeriod);

    // Histogram
    const histogram: number[] = [];
    const signalOffset = signalPeriod - 1;
    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[i + signalOffset] - signalLine[i]);
    }

    return {
      macd: macdLine,
      signal: signalLine,
      histogram
    };
  }

  /**
   * Calculate Volume Average
   */
  public static volumeAverage(candles: Candle[], period: number = 20): number[] {
    const volumes = candles.map(c => c.volume);
    return this.sma(volumes, period);
  }

  /**
   * Detect if price crossed above/below a level
   */
  public static crossOver(values1: number[], values2: number[]): boolean {
    const len = Math.min(values1.length, values2.length);
    if (len < 2) return false;

    const current1 = values1[len - 1];
    const current2 = values2[len - 1];
    const prev1 = values1[len - 2];
    const prev2 = values2[len - 2];

    return prev1 <= prev2 && current1 > current2;
  }

  public static crossUnder(values1: number[], values2: number[]): boolean {
    const len = Math.min(values1.length, values2.length);
    if (len < 2) return false;

    const current1 = values1[len - 1];
    const current2 = values2[len - 1];
    const prev1 = values1[len - 2];
    const prev2 = values2[len - 2];

    return prev1 >= prev2 && current1 < current2;
  }

  /**
   * Calculate percentage change
   */
  public static percentChange(oldValue: number, newValue: number): number {
    return ((newValue - oldValue) / oldValue) * 100;
  }

  /**
   * Calculate standard deviation
   */
  public static stdDev(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Find pivot highs and lows
   */
  public static findPivots(
    candles: Candle[],
    leftBars: number = 5,
    rightBars: number = 5
  ): { highs: number[]; lows: number[] } {
    const highs: number[] = [];
    const lows: number[] = [];

    for (let i = leftBars; i < candles.length - rightBars; i++) {
      // Check for pivot high
      let isPivotHigh = true;
      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (j !== i && candles[j].high >= candles[i].high) {
          isPivotHigh = false;
          break;
        }
      }
      if (isPivotHigh) highs.push(candles[i].high);

      // Check for pivot low
      let isPivotLow = true;
      for (let j = i - leftBars; j <= i + rightBars; j++) {
        if (j !== i && candles[j].low <= candles[i].low) {
          isPivotLow = false;
          break;
        }
      }
      if (isPivotLow) lows.push(candles[i].low);
    }

    return { highs, lows };
  }

  /**
   * Calculate Higher Highs and Lower Lows (trend detection)
   */
  public static detectTrendStructure(candles: Candle[], lookback: number = 20): {
    higherHighs: boolean;
    lowerLows: boolean;
    higherLows: boolean;
    lowerHighs: boolean;
  } {
    if (candles.length < lookback + 10) {
      return { higherHighs: false, lowerLows: false, higherLows: false, lowerHighs: false };
    }

    const recent = candles.slice(-lookback);
    const earlier = candles.slice(-lookback * 2, -lookback);

    const recentHigh = Math.max(...recent.map(c => c.high));
    const recentLow = Math.min(...recent.map(c => c.low));
    const earlierHigh = Math.max(...earlier.map(c => c.high));
    const earlierLow = Math.min(...earlier.map(c => c.low));

    return {
      higherHighs: recentHigh > earlierHigh,
      lowerLows: recentLow < earlierLow,
      higherLows: recentLow > earlierLow,
      lowerHighs: recentHigh < earlierHigh
    };
  }
}