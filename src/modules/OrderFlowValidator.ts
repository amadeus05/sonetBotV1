/**
 * Order Flow Validator
 * Responsibility: Validate signals using order flow data (CVD, OI, Liquidations)
 * This adds extra confirmation layer - use when data is available
 */

import { OrderFlowData, OrderFlowConfirmation, TrendDirection } from '../types';
import { config } from '../config/ConfigManager';

export class OrderFlowValidator {
  /**
   * Validate signal using order flow data
   */
  public validate(
    orderFlow: OrderFlowData | undefined,
    direction: TrendDirection
  ): OrderFlowConfirmation {
    // If no order flow data, return neutral confirmation
    if (!orderFlow) {
      return {
        confirmed: true, // Don't block trades if data unavailable
        cvdAligned: true,
        oiConfirmed: true,
        liquidationsSupport: true,
        score: 0.5 // Neutral score
      };
    }

    const strategyConfig = config.getStrategyConfig();

    // Check CVD alignment
    const cvdAligned = this.checkCVDAlignment(orderFlow, direction, strategyConfig);

    // Check OI confirmation
    const oiConfirmed = this.checkOIConfirmation(orderFlow, direction, strategyConfig);

    // Check liquidations support
    const liquidationsSupport = this.checkLiquidations(orderFlow, direction);

    // Calculate overall score
    const score = this.calculateScore(cvdAligned, oiConfirmed, liquidationsSupport);

    // Overall confirmation (require at least 2 of 3)
    const confirmedCount = [cvdAligned, oiConfirmed, liquidationsSupport].filter(Boolean).length;
    const confirmed = confirmedCount >= 2;

    return {
      confirmed,
      cvdAligned,
      oiConfirmed,
      liquidationsSupport,
      score
    };
  }

  /**
   * Check CVD (Cumulative Volume Delta) alignment
   */
  private checkCVDAlignment(
    orderFlow: OrderFlowData,
    direction: TrendDirection,
    config: any
  ): boolean {
    const cvdChange = orderFlow.cvdChange;

    // For long: CVD should be positive (buyers dominating)
    if (direction === TrendDirection.BULLISH) {
      return cvdChange > config.cvdThreshold;
    }

    // For short: CVD should be negative (sellers dominating)
    if (direction === TrendDirection.BEARISH) {
      return cvdChange < -config.cvdThreshold;
    }

    return false;
  }

  /**
   * Check Open Interest confirmation
   */
  private checkOIConfirmation(
    orderFlow: OrderFlowData,
    direction: TrendDirection,
    config: any
  ): boolean {
    const oiChange = orderFlow.oiChange;

    // Rising OI = new money entering
    // Ideal: OI increases in direction of trend
    
    if (direction === TrendDirection.BULLISH) {
      // For longs: prefer rising OI (new longs opening)
      return oiChange > config.oiChangeMin;
    }

    if (direction === TrendDirection.BEARISH) {
      // For shorts: prefer rising OI (new shorts opening)
      // OR falling OI with price falling (longs closing)
      return oiChange > config.oiChangeMin || oiChange < -config.oiChangeMin;
    }

    return false;
  }

  /**
   * Check liquidations support
   */
  private checkLiquidations(
    orderFlow: OrderFlowData,
    direction: TrendDirection
  ): boolean {
    const { liquidationsLong, liquidationsShort } = orderFlow;

    // For long entries: prefer short liquidations (shorts getting rekt)
    if (direction === TrendDirection.BULLISH) {
      return liquidationsShort > liquidationsLong * 1.5;
    }

    // For short entries: prefer long liquidations (longs getting rekt)
    if (direction === TrendDirection.BEARISH) {
      return liquidationsLong > liquidationsShort * 1.5;
    }

    return false;
  }

  /**
   * Calculate overall order flow score
   */
  private calculateScore(
    cvdAligned: boolean,
    oiConfirmed: boolean,
    liquidationsSupport: boolean
  ): number {
    let score = 0;

    if (cvdAligned) score += 0.4;
    if (oiConfirmed) score += 0.3;
    if (liquidationsSupport) score += 0.3;

    return score;
  }

  /**
   * Detect order flow divergence (warning sign)
   */
  public detectDivergence(
    orderFlow: OrderFlowData,
    priceDirection: TrendDirection
  ): boolean {
    if (!orderFlow) return false;

    // Price going up but CVD negative = bearish divergence
    if (priceDirection === TrendDirection.BULLISH && orderFlow.cvdChange < -0.5) {
      return true;
    }

    // Price going down but CVD positive = bullish divergence
    if (priceDirection === TrendDirection.BEARISH && orderFlow.cvdChange > 0.5) {
      return true;
    }

    return false;
  }

  /**
   * Check if order flow shows strong conviction
   */
  public hasStrongConviction(orderFlow: OrderFlowData | undefined): boolean {
    if (!orderFlow) return false;

    // Strong conviction = high CVD change + high OI change
    const strongCVD = Math.abs(orderFlow.cvdChange) > 1.0;
    const strongOI = Math.abs(orderFlow.oiChange) > 0.2;

    return strongCVD && strongOI;
  }

  /**
   * Get order flow summary
   */
  public getOrderFlowSummary(confirmation: OrderFlowConfirmation): string {
    const emoji = confirmation.confirmed ? '✅' : '❌';
    const scorePercent = (confirmation.score * 100).toFixed(0);

    const details: string[] = [];
    if (confirmation.cvdAligned) details.push('CVD✓');
    if (confirmation.oiConfirmed) details.push('OI✓');
    if (confirmation.liquidationsSupport) details.push('LIQ✓');

    return `${emoji} OrderFlow: ${scorePercent}% | ${details.join(' ')}`;
  }

  /**
   * Calculate order flow confidence multiplier (0.5 - 1.5)
   * Used to adjust position size or skip trades
   */
  public getConfidenceMultiplier(confirmation: OrderFlowConfirmation): number {
    // Base multiplier is 1.0
    // Perfect order flow = 1.5x
    // Poor order flow = 0.5x
    return 0.5 + (confirmation.score * 1.0);
  }
}