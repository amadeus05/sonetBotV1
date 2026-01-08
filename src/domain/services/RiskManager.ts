/**
 * RiskManager - Pure Domain Service
 * 
 * Stateless risk management calculations.
 * All methods accept current state as arguments - no DB access, no side effects.
 * This makes the service pure, testable, and predictable.
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../../di/types';
import { ConfigService } from '../../infrastructure/config/ConfigService';
import {
    IRiskManager,
    PositionSizeResult,
    SignalValidationResult,
    RiskExposure
} from '../interfaces/IRiskManager';
import { Position, TradingSignal } from '../../types';

@injectable()
export class RiskManager implements IRiskManager {
    constructor(
        @inject(TYPES.IConfigService) private readonly configService: ConfigService
    ) { }

    /**
     * Calculate position size based on entry, stop loss, and account balance.
     * Uses fixed-fractional position sizing (risk a fixed % per trade).
     */
    calculatePositionSize(
        entryPrice: number,
        stopLoss: number,
        accountBalance: number,
        confidence: number = 0.5
    ): PositionSizeResult {
        const riskConfig = this.configService.getRiskConfig();

        // Calculate stop loss distance as percentage
        const slDistance = Math.abs(entryPrice - stopLoss);
        const slPercent = (slDistance / entryPrice) * 100;

        // Guard against zero stop distance
        if (slPercent === 0) {
            return {
                size: 0,
                quantity: 0,
                risk: 0,
                riskPercent: 0,
                leverage: riskConfig.leverage
            };
        }

        // Calculate risk amount in dollars
        const riskAmount = accountBalance * riskConfig.riskPerTrade;

        // Position size = risk amount / (stop loss % / 100)
        const baseSize = riskAmount / (slPercent / 100);

        // Confidence multiplier: scale between 0.8x and 1.0x based on confidence
        const confidenceMultiplier = 0.8 + (confidence * 0.2);
        const adjustedSize = baseSize * confidenceMultiplier;

        return {
            size: adjustedSize,
            quantity: adjustedSize / entryPrice,
            risk: riskAmount * confidenceMultiplier,
            riskPercent: riskConfig.riskPerTrade * 100 * confidenceMultiplier,
            leverage: riskConfig.leverage
        };
    }

    /**
     * Validate a trading signal against risk rules.
     */
    validateSignal(
        signal: TradingSignal,
        accountBalance: number,
        activePositions: Position[]
    ): SignalValidationResult {
        const riskConfig = this.configService.getRiskConfig();

        // Check minimum position size
        if (signal.positionSize < 10) {
            return { valid: false, reason: 'Position size too small (min $10)' };
        }

        // Check max open trades
        if (activePositions.length >= riskConfig.maxOpenTrades) {
            return { valid: false, reason: `Max open trades reached (${riskConfig.maxOpenTrades})` };
        }

        // Check if already have position in this symbol
        const existingPosition = activePositions.find(p => p.symbol === signal.symbol);
        if (existingPosition) {
            return { valid: false, reason: `Position already open for ${signal.symbol}` };
        }

        // Check risk-reward ratio
        const rr = this.calculateRiskReward(signal.entry, signal.stopLoss, signal.takeProfit);
        if (rr < riskConfig.minRR) {
            return { valid: false, reason: `Risk:Reward ${rr.toFixed(2)} below minimum ${riskConfig.minRR}` };
        }

        // Check portfolio risk exposure
        const exposure = this.calculateRiskExposure(activePositions, accountBalance);
        const newTradeRisk = Math.abs(signal.entry - signal.stopLoss) / signal.entry * signal.positionSize;
        const totalRiskAfterTrade = exposure.totalRisk + newTradeRisk;
        const maxPortfolioRisk = accountBalance * 0.1; // Max 10% portfolio risk

        if (totalRiskAfterTrade > maxPortfolioRisk) {
            return { valid: false, reason: 'Portfolio risk limit exceeded' };
        }

        return { valid: true };
    }

    /**
     * Check if a new position can be opened based on current state.
     */
    canOpenPosition(activePositions: Position[]): boolean {
        const riskConfig = this.configService.getRiskConfig();
        return activePositions.length < riskConfig.maxOpenTrades;
    }

    /**
     * Calculate current risk exposure from open positions.
     */
    calculateRiskExposure(
        positions: Position[],
        accountBalance: number
    ): RiskExposure {
        let totalExposure = 0;
        let totalRisk = 0;

        for (const position of positions) {
            totalExposure += position.size;

            // Calculate risk as distance to stop loss * position size
            const riskPercent = Math.abs(position.entry - position.stopLoss) / position.entry;
            totalRisk += riskPercent * position.size;
        }

        return {
            totalExposure,
            totalRisk,
            riskPercent: accountBalance > 0 ? (totalRisk / accountBalance) * 100 : 0,
            positionCount: positions.length
        };
    }

    /**
     * Calculate current drawdown from peak balance.
     */
    calculateDrawdown(currentBalance: number, peakBalance: number): number {
        if (peakBalance <= 0) return 0;
        return ((peakBalance - currentBalance) / peakBalance) * 100;
    }

    /**
     * Calculate risk-reward ratio for a trade setup.
     */
    calculateRiskReward(
        entry: number,
        stopLoss: number,
        takeProfit: number
    ): number {
        const risk = Math.abs(entry - stopLoss);
        const reward = Math.abs(takeProfit - entry);

        if (risk === 0) return 0;
        return reward / risk;
    }
}
