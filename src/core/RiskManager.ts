/**
 * Risk Manager
 * Responsibility: Calculate position sizing, manage risk limits, enforce drawdown rules
 * MOST IMPORTANT MODULE - protects capital
 */

import { 
    Candle, 
    Position, 
    PositionSizeCalculation, 
    RiskParameters,
    TradingSignal 
  } from '../types';
  import { TechnicalIndicators } from '../utils/TechnicalIndicators';
  import { config } from '../config/ConfigManager';
  import { db } from '../services/DatabaseManager';
  import { logger } from '../services/Logger';
  import { Helpers } from '../utils/Helpers';
  
  export class RiskManager {
    private currentBalance: number;
    private dailyPnL: number = 0;
    private lastResetDate: string = '';
  
    constructor(initialBalance: number) {
      this.currentBalance = initialBalance;
      this.resetDailyPnL();
    }
  
    /**
     * Calculate position size based on risk parameters
     */
    public calculatePositionSize(
      signal: TradingSignal,
      candles: Candle[]
    ): PositionSizeCalculation {
      const riskParams = config.getRiskConfig();
  
      // Calculate stop loss distance
      const slDistance = Math.abs(signal.entry - signal.stopLoss);
      const slPercent = (slDistance / signal.entry) * 100;
  
      // Calculate risk amount in USD
      const riskAmount = this.currentBalance * riskParams.riskPerTrade;
  
      // Calculate position size
      // Size = (Risk Amount / SL %) * Leverage
      const sizeUSD = (riskAmount / (slPercent / 100)) * riskParams.leverage;
  
      // Calculate quantity in base asset
      const quantity = sizeUSD / signal.entry;
  
      // Apply confidence adjustment (lower confidence = smaller size)
      const adjustedSize = sizeUSD * signal.confidence;
      const adjustedQuantity = quantity * signal.confidence;
  
      return {
        size: adjustedSize,
        quantity: adjustedQuantity,
        risk: riskAmount,
        riskPercent: riskParams.riskPerTrade * 100,
        leverage: riskParams.leverage
      };
    }
  
    /**
     * Calculate stop loss using ATR
     */
    public calculateStopLoss(
      candles: Candle[],
      entry: number,
      isLong: boolean
    ): number {
      const strategyConfig = config.getStrategyConfig();
      
      // Calculate ATR
      const atrValues = TechnicalIndicators.atr(candles, 14);
      
      if (atrValues.length === 0) {
        // Fallback to 2% if ATR not available
        return isLong ? entry * 0.98 : entry * 1.02;
      }
  
      const currentATR = atrValues[atrValues.length - 1];
      const slDistance = currentATR * strategyConfig.stopLossATRMultiplier;
  
      return isLong ? entry - slDistance : entry + slDistance;
    }
  
    /**
     * Calculate take profit based on R:R ratio
     */
    public calculateTakeProfit(
      entry: number,
      stopLoss: number,
      isLong: boolean
    ): number {
      const strategyConfig = config.getStrategyConfig();
      const slDistance = Math.abs(entry - stopLoss);
      const tpDistance = slDistance * strategyConfig.takeProfitRatio;
  
      return isLong ? entry + tpDistance : entry - tpDistance;
    }
  
    /**
     * Check if we can open new position
     */
    public canOpenPosition(): boolean {
      const riskParams = config.getRiskConfig();
      const openPositions = db.getOpenPositions();
  
      // Check max open trades
      if (openPositions.length >= riskParams.maxOpenTrades) {
        logger.warn('RiskManager', 'Max open trades reached', { 
          current: openPositions.length, 
          max: riskParams.maxOpenTrades 
        });
        return false;
      }
  
      // Check daily loss limit
      if (this.hasExceededDailyLoss()) {
        logger.warn('RiskManager', 'Daily loss limit reached', { 
          dailyPnL: this.dailyPnL,
          limit: riskParams.maxDailyLoss * this.currentBalance
        });
        return false;
      }
  
      // Check drawdown limit
      if (this.hasExceededMaxDrawdown()) {
        logger.warn('RiskManager', 'Maximum drawdown exceeded');
        return false;
      }
  
      return true;
    }
  
    /**
     * Check if daily loss limit exceeded
     */
    private hasExceededDailyLoss(): boolean {
      this.resetDailyPnL();
      const riskParams = config.getRiskConfig();
      const maxDailyLoss = this.currentBalance * riskParams.maxDailyLoss;
  
      return this.dailyPnL <= -maxDailyLoss;
    }
  
    /**
     * Check if max drawdown exceeded
     */
    private hasExceededMaxDrawdown(): boolean {
      const riskParams = config.getRiskConfig();
      const initialBalance = riskParams.accountBalance;
      const drawdown = ((initialBalance - this.currentBalance) / initialBalance) * 100;
  
      return drawdown >= (riskParams.maxDrawdown * 100);
    }
  
    /**
     * Update balance after trade
     */
    public updateBalance(pnl: number): void {
      this.currentBalance += pnl;
      this.dailyPnL += pnl;
  
      logger.info('RiskManager', 'Balance updated', {
        pnl: Helpers.formatCurrency(pnl),
        newBalance: Helpers.formatCurrency(this.currentBalance),
        dailyPnL: Helpers.formatCurrency(this.dailyPnL)
      });
    }
  
    /**
     * Reset daily PnL counter
     */
    private resetDailyPnL(): void {
      const today = new Date().toISOString().split('T')[0];
      
      if (this.lastResetDate !== today) {
        this.dailyPnL = 0;
        this.lastResetDate = today;
      }
    }
  
    /**
     * Get current balance
     */
    public getBalance(): number {
      return this.currentBalance;
    }
  
    /**
     * Get daily PnL
     */
    public getDailyPnL(): number {
      this.resetDailyPnL();
      return this.dailyPnL;
    }
  
    /**
     * Calculate current drawdown
     */
    public getCurrentDrawdown(): number {
      const riskParams = config.getRiskConfig();
      const initialBalance = riskParams.accountBalance;
      return ((initialBalance - this.currentBalance) / initialBalance) * 100;
    }
  
    /**
     * Validate signal before trading
     */
    public validateSignal(signal: TradingSignal): { valid: boolean; reason?: string } {
      // Check if position size is reasonable
      const posSize = this.calculatePositionSize(signal, []);
      
      if (posSize.size < 10) {
        return { valid: false, reason: 'Position size too small' };
      }
  
      if (posSize.size > this.currentBalance * 0.5) {
        return { valid: false, reason: 'Position size too large (>50% of balance)' };
      }
  
      // Check R:R ratio
      const rr = Helpers.calculateRR(signal.entry, signal.stopLoss, signal.takeProfit, 
                                     signal.type === 'LONG');
      const minRR = 1.5;
  
      if (rr < minRR) {
        return { valid: false, reason: `R:R too low (${rr.toFixed(2)} < ${minRR})` };
      }
  
      // Check confidence threshold
      if (signal.confidence < 0.5) {
        return { valid: false, reason: 'Signal confidence too low' };
      }
  
      return { valid: true };
    }
  
    /**
     * Calculate Kelly Criterion (optional, advanced)
     */
    public calculateKellyCriterion(winRate: number, avgWin: number, avgLoss: number): number {
      // Kelly % = W - ((1 - W) / R)
      // W = win rate (decimal)
      // R = win/loss ratio
      
      if (avgLoss === 0) return 0;
      
      const R = avgWin / Math.abs(avgLoss);
      const kelly = winRate - ((1 - winRate) / R);
  
      // Use fractional Kelly (25% of full Kelly) for safety
      return Math.max(0, Math.min(kelly * 0.25, 0.05)); // Max 5% risk
    }
  
    /**
     * Get risk summary
     */
    public getRiskSummary(): string {
      const drawdown = this.getCurrentDrawdown();
      const dailyPnL = this.getDailyPnL();
      const openPositions = db.getOpenPositions().length;
  
      return `💰 Balance: ${Helpers.formatCurrency(this.currentBalance)} | ` +
             `📊 Daily P&L: ${Helpers.formatCurrency(dailyPnL)} | ` +
             `📉 Drawdown: ${Helpers.formatPercent(drawdown)} | ` +
             `📈 Open: ${openPositions}`;
    }
  
    /**
     * Emergency stop (close all positions)
     */
    public shouldEmergencyStop(): boolean {
      // Stop if drawdown > 20% (critical)
      const drawdown = this.getCurrentDrawdown();
      if (drawdown > 20) {
        logger.error('RiskManager', 'EMERGENCY STOP: Critical drawdown', { drawdown });
        return true;
      }
  
      // Stop if daily loss > 10%
      this.resetDailyPnL();
      const dailyLossPercent = (this.dailyPnL / this.currentBalance) * 100;
      if (dailyLossPercent < -10) {
        logger.error('RiskManager', 'EMERGENCY STOP: Critical daily loss', { 
          dailyLoss: dailyLossPercent 
        });
        return true;
      }
  
      return false;
    }
  }