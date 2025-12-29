/**
 * Order Flow Validator
 * Responsibility: Validate signals using order flow data (CVD, OI, Liquidations)
 * UPDATED: V7 Logic (Normalized CVD & Adaptive Scoring)
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
    // If no order flow data, return neutral confirmation (don't block trades)
    if (!orderFlow) {
      return {
        confirmed: true, 
        cvdAligned: true,
        oiConfirmed: true,
        liquidationsSupport: true,
        score: 0.5 // Neutral score
      };
    }

    const strategyConfig = config.getStrategyConfig();

    // 1. Check CVD Alignment (Normalized -1 to 1)
    const cvdAligned = this.checkCVDAlignment(orderFlow, direction);

    // 2. Check OI Confirmation
    const oiConfirmed = this.checkOIConfirmation(orderFlow, direction);

    // 3. Check Liquidations (Adaptive)
    // In backtest, liquidation data is usually 0. We shouldn't penalize the score for this.
    const hasLiquidationData = orderFlow.liquidationsLong > 0 || orderFlow.liquidationsShort > 0;
    
    const liquidationsSupport = hasLiquidationData 
        ? this.checkLiquidations(orderFlow, direction)
        : true; // Pass by default if data is missing

    // 4. Calculate Score based on available data
    const score = this.calculateScore(cvdAligned, oiConfirmed, liquidationsSupport, hasLiquidationData);

    // 5. Overall confirmation logic
    // We require a good score (> 0.5) AND at least one primary factor (CVD or OI)
    const confirmed = score >= 0.5 && (cvdAligned || oiConfirmed);

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
   * Expects normalized CVD (-1 to 1)
   */
  private checkCVDAlignment(
    orderFlow: OrderFlowData,
    direction: TrendDirection
  ): boolean {
    const delta = orderFlow.cvdChange;
    
    // Threshold: 0.02 means 2% more buy volume than sell volume (or vice versa).
    // This is sensitive enough for small timeframes.
    const threshold = 0.02; 

    // For LONG: We want positive Delta (Buyers > Sellers)
    if (direction === TrendDirection.BULLISH) {
      return delta > threshold;
    }

    // For SHORT: We want negative Delta (Sellers > Buyers)
    if (direction === TrendDirection.BEARISH) {
      return delta < -threshold;
    }

    return false;
  }

  /**
   * Check Open Interest confirmation
   */
  private checkOIConfirmation(
    orderFlow: OrderFlowData,
    direction: TrendDirection
  ): boolean {
    const oiChange = orderFlow.oiChange; // in Percent
    const minOIChange = 0.05; // 0.05% change per candle

    // Rising OI indicates new money entering the market, confirming the move.
    
    if (direction === TrendDirection.BULLISH) {
      // For Longs: We want rising OI (Aggressive buying)
      return oiChange > minOIChange;
    }

    if (direction === TrendDirection.BEARISH) {
      // For Shorts: 
      // 1. Rising OI (Aggressive shorting) -> Strongest signal
      // 2. Falling OI (Longs liquidation/puking) -> Can also drive price down
      return oiChange > minOIChange || oiChange < -minOIChange;
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

    // For BULLISH move: We like to see Shorts getting liquidated (Short Squeeze fuel)
    if (direction === TrendDirection.BULLISH) {
      return liquidationsShort > liquidationsLong;
    }

    // For BEARISH move: We like to see Longs getting liquidated (Long Squeeze fuel)
    if (direction === TrendDirection.BEARISH) {
      return liquidationsLong > liquidationsShort;
    }

    return false;
  }

  /**
   * Calculate overall order flow score
   */
  private calculateScore(
    cvdAligned: boolean,
    oiConfirmed: boolean,
    liquidationsSupport: boolean,
    hasLiquidationData: boolean
  ): number {
    let score = 0;

    if (hasLiquidationData) {
        // Scenario: Real-time trading (All data available)
        if (cvdAligned) score += 0.4;
        if (oiConfirmed) score += 0.3;
        if (liquidationsSupport) score += 0.3;
    } else {
        // Scenario: Backtest (Only CVD and OI available)
        // Redistribute weights
        if (cvdAligned) score += 0.6; // CVD is the most important
        if (oiConfirmed) score += 0.4;
    }

    return score;
  }

  /**
   * Detect order flow divergence (warning sign)
   * Example: Price UP but CVD DOWN (Absorption/Limit Sellers)
   */
  public detectDivergence(
    orderFlow: OrderFlowData,
    priceDirection: TrendDirection
  ): boolean {
    if (!orderFlow) return false;

    // Price BULLISH but CVD BEARISH (Strong selling into buying)
    if (priceDirection === TrendDirection.BULLISH && orderFlow.cvdChange < -0.05) {
      return true;
    }

    // Price BEARISH but CVD BULLISH (Strong buying into selling)
    if (priceDirection === TrendDirection.BEARISH && orderFlow.cvdChange > 0.05) {
      return true;
    }

    return false;
  }

  /**
   * Get order flow summary for logs
   */
  public getOrderFlowSummary(confirmation: OrderFlowConfirmation): string {
    const emoji = confirmation.confirmed ? '✅' : '⚠️';
    const scorePercent = (confirmation.score * 100).toFixed(0);

    const details: string[] = [];
    details.push(confirmation.cvdAligned ? 'CVD+' : 'CVD-');
    details.push(confirmation.oiConfirmed ? 'OI+' : 'OI-');
    
    // Only show Liq status if it was actually checked (score < 1.0 implies strict checking or missing data handling)
    if (confirmation.liquidationsSupport) details.push('LIQ+');

    return `${emoji} OF:${scorePercent}% [${details.join(' ')}]`;
  }

  /**
   * Calculate order flow confidence multiplier
   */
  public getConfidenceMultiplier(confirmation: OrderFlowConfirmation): number {
    // 0.8 (Weak) to 1.2 (Strong)
    return 0.8 + (confirmation.score * 0.4);
  }
}