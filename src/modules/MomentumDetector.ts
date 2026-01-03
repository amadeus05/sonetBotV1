/**
 * Momentum Detector
 * Responsibility: Detect momentum spikes and directional strength
 * Using RSI, volume analysis, and price velocity
 */

import { Candle, MomentumSignal, TrendDirection } from '../types';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';
import { config } from '../config/ConfigManager';

export class MomentumDetector {
  /**
   * Detect momentum signals
   */
  public detect(candles: Candle[]): MomentumSignal {
    const strategyConfig = config.getStrategyConfig();

    // Calculate RSI
    const closes = candles.map(c => c.close);
    const rsiValues = TechnicalIndicators.rsi(closes, strategyConfig.rsiPeriod);
    
    if (rsiValues.length === 0) {
      return this.getNeutralMomentum();
    }

    const currentRsi = rsiValues[rsiValues.length - 1];

    // Calculate volume spike
    const volumeRatio = this.calculateVolumeSpike(candles);

    // Calculate price velocity
    const priceChange = this.calculatePriceVelocity(candles);

    // Determine if there's a momentum spike
    const hasSpike = this.hasMomentumSpike(
      currentRsi,
      volumeRatio,
      priceChange,
      strategyConfig
    );

    // Determine direction
    const direction = this.determineMomentumDirection(
      currentRsi,
      priceChange,
      strategyConfig
    );

    // Calculate high, low, atr for StrategyEngine momentum pullback
    const recentCandles = candles.slice(-14);
    const high = Math.max(...recentCandles.map(c => c.high));
    const low = Math.min(...recentCandles.map(c => c.low));

    // Calculate ATR
    const atrValues = TechnicalIndicators.atr(candles, 14);
    const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : (high - low);

    return {
      hasSpike,
      rsi: currentRsi,
      volumeRatio,
      priceChange,
      direction,
      high,
      low,
      atr
    };
  }

  /**
   * Calculate volume spike ratio
   */
  private calculateVolumeSpike(candles: Candle[]): number {
    if (candles.length < 20) return 1;

    const currentVolume = candles[candles.length - 1].volume;
    const avgVolume = TechnicalIndicators.volumeAverage(candles, 20);
    
    if (avgVolume.length === 0) return 1;

    const recentAvgVolume = avgVolume[avgVolume.length - 1];
    return recentAvgVolume > 0 ? currentVolume / recentAvgVolume : 1;
  }

  /**
   * Calculate price velocity (% change over last N candles)
   */
  private calculatePriceVelocity(candles: Candle[], lookback: number = 10): number {
    if (candles.length < lookback + 1) return 0;

    const currentPrice = candles[candles.length - 1].close;
    const oldPrice = candles[candles.length - 1 - lookback].close;

    return ((currentPrice - oldPrice) / oldPrice) * 100;
  }

  /**
   * Check if there's a momentum spike
   */
  private hasMomentumSpike(
    rsi: number,
    volumeRatio: number,
    priceChange: number,
    config: any
  ): boolean {
    // RSI extreme condition
    const rsiExtreme = rsi > config.rsiOverbought || rsi < config.rsiOversold;

    // Volume spike condition (relaxed to 1.5x)
    const volumeSpike = volumeRatio >= 1.5;

    // Price movement (relaxed to 0.5% for 5m timeframe)
    const significantMove = Math.abs(priceChange) >= 0.5;

    // NEW LOGIC: Accept spike if EITHER:
    // 1. Strong volume (1.8x+) alone
    // 2. OR volume (1.5x+) + price movement (0.5%+)
    // 3. OR RSI extreme + volume spike
    
    if (volumeRatio >= 1.8) return true; // Strong volume alone
    if (volumeSpike && significantMove) return true; // Both present
    if (rsiExtreme && volumeSpike) return true; // RSI + volume
    
    return false;
  }

  /**
   * Determine momentum direction
   */
  private determineMomentumDirection(
    rsi: number,
    priceChange: number,
    config: any
  ): TrendDirection {
    // Price change is primary signal
    if (priceChange > 0.5) return TrendDirection.BULLISH;
    if (priceChange < -0.5) return TrendDirection.BEARISH;
    
    // RSI as secondary confirmation
    if (rsi > 55) return TrendDirection.BULLISH;
    if (rsi < 45) return TrendDirection.BEARISH;

    return TrendDirection.NEUTRAL;
  }

  /**
   * Calculate momentum score (0-1)
   */
  public calculateMomentumScore(signal: MomentumSignal): number {
    const strategyConfig = config.getStrategyConfig();

    // RSI score - distance from neutral
    const rsiDistance = Math.abs(signal.rsi - 50) / 50;
    const rsiScore = Math.min(rsiDistance, 1);

    // Volume score - how much above average
    const volumeScore = Math.min((signal.volumeRatio - 1) / 2, 1);

    // Price change score
    const priceScore = Math.min(Math.abs(signal.priceChange) / 10, 1);

    // Weighted average
    return (rsiScore * 0.4 + volumeScore * 0.3 + priceScore * 0.3);
  }

  /**
   * Check if momentum is bullish
   */
  public isBullish(signal: MomentumSignal): boolean {
    return signal.direction === TrendDirection.BULLISH && signal.hasSpike;
  }

  /**
   * Check if momentum is bearish
   */
  public isBearish(signal: MomentumSignal): boolean {
    return signal.direction === TrendDirection.BEARISH && signal.hasSpike;
  }

  /**
   * Check for momentum divergence
   */
  public detectDivergence(candles: Candle[]): {
    bullishDiv: boolean;
    bearishDiv: boolean;
  } {
    if (candles.length < 50) {
      return { bullishDiv: false, bearishDiv: false };
    }

    const closes = candles.map(c => c.close);
    const rsiValues = TechnicalIndicators.rsi(closes, 14);

    if (rsiValues.length < 30) {
      return { bullishDiv: false, bearishDiv: false };
    }

    // Get recent price and RSI
    const recentPrices = closes.slice(-20);
    const recentRSI = rsiValues.slice(-20);

    // Find recent lows and highs
    const priceLow1 = Math.min(...recentPrices.slice(0, 10));
    const priceLow2 = Math.min(...recentPrices.slice(10));
    const priceHigh1 = Math.max(...recentPrices.slice(0, 10));
    const priceHigh2 = Math.max(...recentPrices.slice(10));

    const rsiLow1 = Math.min(...recentRSI.slice(0, 10));
    const rsiLow2 = Math.min(...recentRSI.slice(10));
    const rsiHigh1 = Math.max(...recentRSI.slice(0, 10));
    const rsiHigh2 = Math.max(...recentRSI.slice(10));

    // Bullish divergence: price makes lower low, RSI makes higher low
    const bullishDiv = priceLow2 < priceLow1 && rsiLow2 > rsiLow1;

    // Bearish divergence: price makes higher high, RSI makes lower high
    const bearishDiv = priceHigh2 > priceHigh1 && rsiHigh2 < rsiHigh1;

    return { bullishDiv, bearishDiv };
  }

  /**
   * Get neutral momentum
   */
  private getNeutralMomentum(): MomentumSignal {
    return {
      hasSpike: false,
      rsi: 50,
      volumeRatio: 1,
      priceChange: 0,
      direction: TrendDirection.NEUTRAL,
      high: 0,
      low: 0,
      atr: 0
    };
  }

  /**
   * Get momentum summary
   */
  public getMomentumSummary(signal: MomentumSignal): string {
    const directionEmoji = {
      [TrendDirection.BULLISH]: '🚀',
      [TrendDirection.BEARISH]: '💥',
      [TrendDirection.NEUTRAL]: '➡️'
    };

    const spikeStatus = signal.hasSpike ? 'SPIKE' : 'NORMAL';
    const score = this.calculateMomentumScore(signal);

    return `${directionEmoji[signal.direction]} ${spikeStatus} | RSI: ${signal.rsi.toFixed(1)} | Vol: ${signal.volumeRatio.toFixed(2)}x | Score: ${(score * 100).toFixed(0)}%`;
  }
}