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

const MAX_TOTAL_MARGIN_COMMITMENT_RATIO = 0.5; // Максимум 50% от текущей эквити может быть задействовано под начальную маржу всех позиций.
                                               // Это защитный механизм против чрезмерного использования маржи.

export class RiskManager {
  private currentBalance: number;
  private dailyStartBalance: number; // Баланс на начало дня для фиксации лимита потерь
  private dailyPnL: number = 0;
  private lastResetDate: string = '';

  constructor(initialBalance: number) {
    this.currentBalance = initialBalance;
    this.dailyStartBalance = initialBalance; // Инициализируем стартовым балансом
    this.resetDailyPnL();
  }

  /**
   * Calculate position size based on risk parameters
   */
  public calculatePositionSize(
      signal: TradingSignal,
      candles: Candle[] // candles parameter is not used in the current implementation, but kept for interface consistency
    ): PositionSizeCalculation {
      const riskParams = config.getRiskConfig();
  
      // Calculate stop loss distance
      const slDistance = Math.abs(signal.entry - signal.stopLoss);
      const slPercent = (slDistance / signal.entry) * 100;
  
      // If stop loss is too tight (e.g., 0 distance), prevent division by zero or overly large positions
      if (slPercent === 0) {
          logger.warn('RiskManager', `Stop loss distance is zero for ${signal.symbol}, cannot calculate position size. Signal entry: ${signal.entry}, SL: ${signal.stopLoss}`);
          // Return a minimal, non-tradable size. This will be caught by the notionalSize < 10 check in validateSignal.
          return {
              size: 0,
              quantity: 0,
              risk: 0,
              riskPercent: 0,
              leverage: riskParams.leverage
          };
      }

      // Calculate risk amount in USD (например $1000 * 1% = $10)
      const riskAmount = this.currentBalance * riskParams.riskPerTrade;
  
      // This `sizeUSD` is the NOTIONAL value of the position (объем сделки в USD)
      // Size = Risk Amount / SL %
      // Например, если риск $10, а стоп 1% (0.01), то номинальный объем позиции = $10 / 0.01 = $1000
      const sizeUSD = riskAmount / (slPercent / 100); 
  
      // Calculate quantity in base asset
      const quantity = sizeUSD / signal.entry;
  
      // ИСПРАВЛЕНИЕ (Правка 2): Не масштабируем позицию линейно от confidence (0.1-1.0), так как это ломает R:R.
      // Вместо этого используем confidence как небольшой бонус/штраф к размеру (диапазон 0.8 - 1.0).
      // Если confidence = 0.5 -> множитель 0.9
      // Если confidence = 1.0 -> множитель 1.0
      const confidenceMultiplier = 0.8 + (signal.confidence * 0.2);

      const adjustedSize = sizeUSD * confidenceMultiplier;
      const adjustedQuantity = quantity * confidenceMultiplier;
  
      return {
        size: adjustedSize, // Номинальный объем позиции в USD
        quantity: adjustedQuantity, // Количество базового актива
        risk: riskAmount * confidenceMultiplier,
        riskPercent: riskParams.riskPerTrade * 100 * confidenceMultiplier,
        leverage: riskParams.leverage
      };
  }

  /**
   * Get current risk configuration
   */
  public getRiskConfig(): RiskParameters {
      return config.getRiskConfig();
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
        limit: riskParams.maxDailyLoss * this.dailyStartBalance
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
    
    // ИСПРАВЛЕНИЕ: Считаем лимит от баланса на НАЧАЛО дня, а не от текущего
    const maxDailyLoss = this.dailyStartBalance * riskParams.maxDailyLoss;

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
      // Фиксируем баланс на начало нового дня
      this.dailyStartBalance = this.currentBalance;
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
    const riskParams = config.getRiskConfig(); 
    const posSizeCalculation = this.calculatePositionSize(signal, []); // Это возвращает номинальный объем позиции (size) с учетом confidence множителя

    const notionalSize = posSizeCalculation.size; // Номинальный объем для новой позиции

    // 1. Проверка на минимальный номинальный размер позиции
    if (notionalSize < 10) { // Binance часто имеет минимальный объем $10 или $5 для ордера
        return { valid: false, reason: `Position notional size too small (${notionalSize.toFixed(2)} USD). Minimum 10 USD.` };
    }

    // ИСПРАВЛЕНИЕ (Правка 1): Проверка маржи
    // 2. Расчет маржи, необходимой для этой новой сделки
    const marginRequiredForNewTrade = notionalSize / riskParams.leverage;

    // 3. Расчет общей маржи, уже используемой открытыми позициями
    const openPositions = db.getOpenPositions();
    let totalMarginCurrentlyUsed = 0;
    for (const openPos of openPositions) {
        // openPos.size - номинальный объем позиции (например, 1 BTC * $70000)
        // openPos.leverage - плечо, используемое для этой конкретной позиции
        totalMarginCurrentlyUsed += openPos.size / openPos.leverage;
    }

    // 4. Текущая эквити счета (баланс + нереализованный PnL) с точки зрения RiskManager
    const currentEquity = this.currentBalance;

    // 5. Проверка общего лимита маржинальных обязательств:
    // Не позволяем суммарной марже превышать заданный процент от текущей эквити.
    const maxTotalMarginAllowed = currentEquity * MAX_TOTAL_MARGIN_COMMITMENT_RATIO;
    
    if (totalMarginCurrentlyUsed + marginRequiredForNewTrade > maxTotalMarginAllowed) {
        return { 
            valid: false, 
            reason: `Opening new position would exceed total margin commitment of ${(MAX_TOTAL_MARGIN_COMMITMENT_RATIO * 100).toFixed(0)}% of equity. ` +
                    `Currently used: ${Helpers.formatCurrency(totalMarginCurrentlyUsed, 0)}, ` +
                    `new trade margin: ${Helpers.formatCurrency(marginRequiredForNewTrade, 0)}, ` +
                    `max allowed: ${Helpers.formatCurrency(maxTotalMarginAllowed, 0)}` 
        };
    }

    // 6. Проверка коэффициента R:R
    const rr = Helpers.calculateRR(signal.entry, signal.stopLoss, signal.takeProfit, 
                                   signal.type === 'LONG');
    const minRR = 1.5;

    if (rr < minRR) {
      return { valid: false, reason: `R:R too low (${rr.toFixed(2)} < ${minRR})` };
    }

    // 7. Проверка порога уверенности сигнала (фильтр)
    if (signal.confidence < 0.3) {
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
    
    // ИСПРАВЛЕНИЕ: Используем dailyStartBalance для расчета процента дневных потерь
    const dailyLossPercent = (this.dailyPnL / this.dailyStartBalance) * 100;
    
    if (dailyLossPercent < -10) {
      logger.error('RiskManager', 'EMERGENCY STOP: Critical daily loss', { 
        dailyLoss: dailyLossPercent 
      });
      return true;
    }

    return false;
  }
}