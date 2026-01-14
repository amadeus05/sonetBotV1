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

const MAX_TOTAL_MARGIN_COMMITMENT_RATIO = 0.8; // Максимум 50% от текущей эквити может быть задействовано под начальную маржу.
const MAX_TOTAL_RISK_EXPOSURE_RATIO = 0.08;    // Максимум 6% от баланса может быть под риском одновременно (суммарный риск).
// Если риск на сделку 1%, это позволит открыть макс 6 сделок.
// Если риск на сделку 2%, это позволит открыть макс 3 сделки.

// DD control tiers (keeps Max DD <= 10% more stable in practice)
const DD_TIER_REDUCE_RISK_PCT = 8; // at/above 8% DD -> reduce risk and max concurrent trades

export class RiskManager {
  private currentBalance: number;
  private dailyStartBalance: number; // Баланс на начало дня для фиксации лимита потерь
  private peakBalance: number;       // Максимальный баланс (High Watermark) для расчета DD
  private dailyPnL: number = 0;
  private lastResetDate: string = '';

  private warnedMaxTrades = false;
  private warnedDailyLoss = false;
  private warnedMaxDrawdown = false;

  private backtestPositions: Position[] | null = null;

  constructor(initialBalance: number) {
    this.currentBalance = initialBalance;
    this.dailyStartBalance = initialBalance;
    this.peakBalance = initialBalance; // Инициализируем пик начальным балансом
    this.resetDailyPnL();
  }

  // 2. Метод для включения режима бэктеста
  public setBacktestPositions(positions: Position[]): void {
    this.backtestPositions = positions;
  }

  // 3. Изменяем логику получения позиций (приватный хелпер)
  private getActivePositions(): Position[] {
    if (this.backtestPositions) {
      return this.backtestPositions; // Бэктест: быстро берем из памяти
    }
    return db.getOpenPositions(); // Лайв: берем из базы
  }

  /**
   * Calculate position size based on risk parameters
   */
  public calculatePositionSize(
    signal: TradingSignal,
    candles: Candle[] // candles parameter is not used in the current implementation, but kept for interface consistency
  ): PositionSizeCalculation {
    const riskParams = config.getRiskConfig();
    const effectiveRiskPerTrade = this.getEffectiveRiskPerTrade();

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
    const riskAmount = this.currentBalance * effectiveRiskPerTrade;

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
      riskPercent: effectiveRiskPerTrade * 100 * confidenceMultiplier,
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
    const openPositions = this.getActivePositions();
    const effectiveMaxOpenTrades = this.getEffectiveMaxOpenTrades();

    // 1. Проверка лимита открытых сделок
    if (openPositions.length >= effectiveMaxOpenTrades) {
      if (!this.warnedMaxTrades) {
        logger.warn('RiskManager', 'Max open trades reached', {
          current: openPositions.length,
          max: effectiveMaxOpenTrades
        });
        this.warnedMaxTrades = true; // Ставим флаг, чтобы больше не писать
      }
      return false;
    }
    this.warnedMaxTrades = false; // Сбрасываем флаг, если место освободилось

    // 2. Проверка дневного лимита потерь
    if (this.hasExceededDailyLoss()) {
      if (!this.warnedDailyLoss) {
        logger.warn('RiskManager', 'Daily loss limit reached', {
          dailyPnL: this.dailyPnL,
          limit: riskParams.maxDailyLoss * this.dailyStartBalance
        });
        this.warnedDailyLoss = true;
      }
      return false;
    }
    this.warnedDailyLoss = false;

    // 3. Проверка лимита просадки
    if (this.hasExceededMaxDrawdown()) {
      if (!this.warnedMaxDrawdown) {
        logger.warn('RiskManager', 'Maximum drawdown exceeded', {
          currentDrawdown: this.getCurrentDrawdown().toFixed(2),
          maxDrawdown: riskParams.maxDrawdown * 100
        });
        this.warnedMaxDrawdown = true;
      }
      return false;
    }
    this.warnedMaxDrawdown = false;

    return true;
  }
  /**
   * Check if daily loss limit exceeded
   */
  private hasExceededDailyLoss(): boolean {
    this.resetDailyPnL();
    const riskParams = config.getRiskConfig();

    // ИСПРАВЛЕНИЕ: Считаем лимит от баланса на НАЧАЛО дня
    const maxDailyLoss = this.dailyStartBalance * riskParams.maxDailyLoss;

    return this.dailyPnL <= -maxDailyLoss;
  }

  /**
   * Check if max drawdown exceeded (Peak-to-Valley)
   */
  private hasExceededMaxDrawdown(): boolean {
    const riskParams = config.getRiskConfig();
    const drawdown = this.getCurrentDrawdown();

    return drawdown >= (riskParams.maxDrawdown * 100);
  }

  /**
   * Update balance after trade
   */
  public updateBalance(pnl: number): void {
    this.currentBalance += pnl;
    this.dailyPnL += pnl;

    // ИСПРАВЛЕНИЕ: Обновляем High Watermark (максимальный баланс)
    if (this.currentBalance > this.peakBalance) {
      this.peakBalance = this.currentBalance;
    }

    logger.info('RiskManager', 'Balance updated', {
      pnl: Helpers.formatCurrency(pnl),
      newBalance: Helpers.formatCurrency(this.currentBalance),
      dailyPnL: Helpers.formatCurrency(this.dailyPnL),
      peakBalance: Helpers.formatCurrency(this.peakBalance)
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
   * Calculate current drawdown (Peak-to-Valley)
   */
  public getCurrentDrawdown(): number {
    if (this.peakBalance === 0) return 0;
    // (Peak - Current) / Peak * 100
    return ((this.peakBalance - this.currentBalance) / this.peakBalance) * 100;
  }

  /**
   * Validate signal before trading
   */
  public validateSignal(signal: TradingSignal): { valid: boolean; reason?: string } {
    const riskParams = config.getRiskConfig();
    const notionalSize = signal.positionSize; // Используем уже рассчитанный размер
    const feeCfg = config.getConfig().fees;

    // 1. Проверка на минимальный номинальный размер позиции
    if (notionalSize < 10) {
      return { valid: false, reason: `Position notional size too small (${notionalSize.toFixed(2)} USD). Minimum 10 USD.` };
    }

    // 1.1 Fee-aware: стоп должен перекрывать хотя бы 2x комиссии (round-trip taker)
    // По ТЗ: "INVALIDATED if SL < fees × 2"
    const slDistance = Math.abs(signal.entry - signal.stopLoss);
    const slPercent = signal.entry > 0 ? (slDistance / signal.entry) : 0;
    const roundTripFeeRate = feeCfg.taker * 2;

    if (!Number.isFinite(slPercent) || slPercent <= 0) {
      return { valid: false, reason: 'Bad SL percent (non-finite or zero)' };
    }

    if (slPercent < roundTripFeeRate) {
      return {
        valid: false,
        reason: `SL too tight vs fees (SL ${(slPercent * 100).toFixed(3)}% < 2xFee ${(roundTripFeeRate * 100).toFixed(3)}%)`
      };
    }

    // 2. Расчет маржи, необходимой для этой новой сделки
    const marginRequiredForNewTrade = notionalSize / riskParams.leverage;

    // 3. Расчет общей маржи и ОБЩЕГО РИСКА открытых позиций
    // IMPORTANT: In backtest mode we must use in-memory positions, not DB.
    const openPositions = this.getActivePositions();
    let totalMarginCurrentlyUsed = 0;
    let totalRiskCurrentlyExposed = 0;

    for (const openPos of openPositions) {
      // Margin
      totalMarginCurrentlyUsed += openPos.size / openPos.leverage;

      // Risk ($) = |Entry - SL| * Quantity
      // Quantity = Size (USD) / Entry
      const quantity = openPos.size / openPos.entry;
      const riskInDollars = Math.abs(openPos.entry - openPos.stopLoss) * quantity;
      totalRiskCurrentlyExposed += riskInDollars;
    }

    // 4. Текущая эквити счета
    const currentEquity = this.currentBalance;

    // 5. Проверка общего лимита маржинальных обязательств
    const maxTotalMarginAllowed = currentEquity * MAX_TOTAL_MARGIN_COMMITMENT_RATIO;
    if (totalMarginCurrentlyUsed + marginRequiredForNewTrade > maxTotalMarginAllowed) {
      return {
        valid: false,
        reason: `Margin commitment limit reached.`
      };
    }

    // ИСПРАВЛЕНИЕ (Правка 6): Проверка Total Risk Exposure
    // 6. Расчет риска новой сделки
    const newTradeRiskDollar = (Math.abs(signal.entry - signal.stopLoss) / signal.entry) * notionalSize;

    // 7. Проверка: Текущий риск + Риск новой сделки <= Лимит (6% от баланса)
    const maxTotalRiskAllowed = currentEquity * MAX_TOTAL_RISK_EXPOSURE_RATIO;
    const projectedTotalRisk = totalRiskCurrentlyExposed + newTradeRiskDollar;

    if (projectedTotalRisk > maxTotalRiskAllowed) {
      return {
        valid: false,
        reason: `Total risk exposure limit exceeded. Projected: ${Helpers.formatCurrency(projectedTotalRisk)} ` +
          `(${((projectedTotalRisk / currentEquity) * 100).toFixed(2)}%), ` +
          `Max allowed: ${Helpers.formatCurrency(maxTotalRiskAllowed)} ` +
          `(${MAX_TOTAL_RISK_EXPOSURE_RATIO * 100}%)`
      };
    }

    // 8. Проверка коэффициента R:R
    const rr = Helpers.calculateRR(signal.entry, signal.stopLoss, signal.takeProfit,
      signal.type === 'LONG');
    const minRR = config.getConfig().risk.minRR; // default 1.5 if good filtering than 1.2

    if (rr < minRR) {
      return { valid: false, reason: `R:R too low (${rr.toFixed(2)} < ${minRR})` };
    }

    // 9. Проверка порога уверенности сигнала
    if (signal.confidence < 0.3) {
      return { valid: false, reason: 'Signal confidence too low' };
    }

    return { valid: true };
  }

  /**
   * Effective risk per trade with drawdown-aware throttling.
   * - Base risk is config.risk.riskPerTrade (0.5% by default in ConfigManager)
   * - At >= 8% DD reduce by 50% to stabilize equity curve
   */
  private getEffectiveRiskPerTrade(): number {
    const base = config.getRiskConfig().riskPerTrade;
    const dd = this.getCurrentDrawdown();
    if (dd >= DD_TIER_REDUCE_RISK_PCT) return base * 0.5;
    return base;
  }

  /**
   * Effective max open trades with drawdown-aware throttling.
   * - Never exceeds config.risk.maxOpenTrades
   * - At >= 8% DD -> cap to 1 trade simultaneously (keeps DD tighter)
   */
  private getEffectiveMaxOpenTrades(): number {
    const base = config.getRiskConfig().maxOpenTrades;
    const dd = this.getCurrentDrawdown();
    if (dd >= DD_TIER_REDUCE_RISK_PCT) return Math.min(base, 1);
    return base;
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
    // IMPORTANT: In backtest mode we must use in-memory positions, not DB.
    const openPositions = this.getActivePositions();

    // Calculate current risk exposure for display
    let totalRisk = 0;
    for (const p of openPositions) {
      totalRisk += (Math.abs(p.entry - p.stopLoss) / p.entry) * p.size;
    }
    const riskPct = this.currentBalance > 0 ? (totalRisk / this.currentBalance) * 100 : 0;

    return `💰 Balance: ${Helpers.formatCurrency(this.currentBalance)} | ` +
      `📊 Daily P&L: ${Helpers.formatCurrency(dailyPnL)} | ` +
      `📉 DD: ${Helpers.formatPercent(drawdown)} | ` +
      `⚠️ Risk Exp: ${riskPct.toFixed(2)}%`;
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