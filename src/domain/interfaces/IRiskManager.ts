/**
 * IRiskManager Interface
 * 
 * Pure domain interface for risk management calculations.
 * All methods are stateless - they accept current state as arguments
 * rather than fetching from external sources.
 */

import { Position, TradingSignal, RiskParameters } from '../../types';

/**
 * Result of position size calculation
 */
export interface PositionSizeResult {
    /** Position size in USD (notional value) */
    size: number;
    /** Quantity in base asset */
    quantity: number;
    /** Dollar amount at risk */
    risk: number;
    /** Risk as percentage of account */
    riskPercent: number;
    /** Leverage to use */
    leverage: number;
}

/**
 * Result of signal validation
 */
export interface SignalValidationResult {
    /** Whether the signal passes all risk checks */
    valid: boolean;
    /** Reason for rejection if not valid */
    reason?: string;
}

/**
 * Risk exposure summary
 */
export interface RiskExposure {
    /** Total dollar exposure across all positions */
    totalExposure: number;
    /** Total risk (potential loss at stop) */
    totalRisk: number;
    /** Risk as percentage of account */
    riskPercent: number;
    /** Number of open positions */
    positionCount: number;
}

/**
 * IRiskManager - Pure Domain Risk Calculator
 * 
 * This interface defines pure calculation methods that:
 * - Accept all required state as arguments
 * - Do not access databases or external services
 * - Are completely stateless and deterministic
 * - Are easy to unit test
 */
export interface IRiskManager {
    /**
     * Calculate position size based on entry, stop loss, and account balance.
     * Uses fixed-fractional position sizing (risk a fixed % per trade).
     * 
     * @param entryPrice - Planned entry price
     * @param stopLoss - Stop loss price
     * @param accountBalance - Current account balance in USD
     * @param confidence - Signal confidence (0-1) for scaling
     * @returns Position size calculation result
     */
    calculatePositionSize(
        entryPrice: number,
        stopLoss: number,
        accountBalance: number,
        confidence?: number
    ): PositionSizeResult;

    /**
     * Validate a trading signal against risk rules.
     * Checks position size, max trades, exposure limits, etc.
     * 
     * @param signal - The trading signal to validate
     * @param accountBalance - Current account balance
     * @param activePositions - Currently open positions
     * @returns Validation result with reason if rejected
     */
    validateSignal(
        signal: TradingSignal,
        accountBalance: number,
        activePositions: Position[]
    ): SignalValidationResult;

    /**
     * Check if a new position can be opened based on current state.
     * 
     * @param activePositions - Currently open positions
     * @returns True if a new position can be opened
     */
    canOpenPosition(activePositions: Position[]): boolean;

    /**
     * Calculate current risk exposure from open positions.
     * 
     * @param positions - Open positions to analyze
     * @param accountBalance - Current account balance
     * @returns Risk exposure summary
     */
    calculateRiskExposure(
        positions: Position[],
        accountBalance: number
    ): RiskExposure;

    /**
     * Calculate current drawdown from peak balance.
     * 
     * @param currentBalance - Current account balance
     * @param peakBalance - Highest account balance achieved
     * @returns Drawdown as percentage (0-100)
     */
    calculateDrawdown(
        currentBalance: number,
        peakBalance: number
    ): number;

    /**
     * Calculate risk-reward ratio for a trade setup.
     * 
     * @param entry - Entry price
     * @param stopLoss - Stop loss price
     * @param takeProfit - Take profit price
     * @returns Risk-reward ratio (e.g., 2.0 = 2:1 reward:risk)
     */
    calculateRiskReward(
        entry: number,
        stopLoss: number,
        takeProfit: number
    ): number;
}
