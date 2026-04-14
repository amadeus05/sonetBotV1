/**
 * Trade Executor
 * Responsibility: Execute trades, manage positions, handle SL/TP
 */

import { injectable, inject } from 'inversify';
import {
  TradingSignal,
  Position,
  PositionStatus,
  PositionSide,
  TradeExitReason,
  SignalType
} from '../../types';
import { BinanceService } from '../../infrastructure/exchanges/binance/BinanceService';
import { IRiskManager } from '../../domain/interfaces/IRiskManager';
import { db } from '../../infrastructure/persistence/DatabaseManager';
import { logger } from '../../infrastructure/logging/Logger';
import { Helpers } from '../../utils/Helpers';
import { config } from '../../infrastructure/config/ConfigService';
import { TYPES } from '../../di/types';

@injectable()
export class TradeExecutor {
  private binance: BinanceService;
  private riskManager: IRiskManager;

  constructor(
    @inject(TYPES.BinanceService) binance: BinanceService,
    @inject(TYPES.IRiskManager) riskManager: IRiskManager
  ) {
    this.binance = binance;
    this.riskManager = riskManager;
  }

  /**
   * Execute a trading signal
   */
  public async executeSignal(signal: TradingSignal): Promise<Position | null> {
    // Check if we can open new position (pass current positions from DB)
    const activePositions = db.getOpenPositions();
    if (!this.riskManager.canOpenPosition(activePositions)) {
      logger.warn('TradeExecutor', 'Cannot open new position - risk limits reached');
      return null;
    }

    try {
      const { symbol, type, entry, stopLoss, takeProfit, positionSize } = signal;
      const isLong = type === SignalType.LONG;
      const side: 'BUY' | 'SELL' = isLong ? 'BUY' : 'SELL';

      // Calculate quantity using dynamic Step Size
      const quantity = this.roundQuantity(positionSize / entry, symbol);

      logger.info('TradeExecutor', `Executing ${type} signal for ${symbol}`, {
        entry,
        quantity,
        stopLoss,
        takeProfit
      });

      // Set leverage
      await this.binance.setLeverage(symbol, config.getRiskConfig().leverage);

      // Place market order
      const order = await this.binance.placeMarketOrder(symbol, side, quantity);

      if (order.status !== 'FILLED') {
        logger.error('TradeExecutor', 'Order not filled', { order });
        return null;
      }

      const rawFill = order.price ?? 0;
      const fillPrice = rawFill > 0 ? rawFill : entry;
      const { stopLoss: adjustedSl, takeProfit: adjustedTp } = Helpers.shiftStopsToExecutionPrice(
        isLong,
        entry,
        stopLoss,
        takeProfit,
        fillPrice
      );

      // Create position
      const position: Position = {
        id: Helpers.generateId(),
        symbol,
        side: isLong ? PositionSide.LONG : PositionSide.SHORT,
        entry: fillPrice,
        size: order.quantity * fillPrice,
        leverage: config.getRiskConfig().leverage,
        stopLoss: adjustedSl,
        takeProfit: adjustedTp,
        openTime: Date.now(),
        status: PositionStatus.OPEN,
        tags: signal.tags
      };

      // Save to database
      db.savePosition(position);

      // Place SL and TP orders
      await this.placeSLTP(position);

      logger.trade(symbol, `✅ Position opened`, {
        id: position.id,
        side: position.side,
        entry: position.entry,
        size: Helpers.formatCurrency(position.size)
      });

      return position;

    } catch (error: any) {
      logger.error('TradeExecutor', 'Failed to execute signal', error.message);
      return null;
    }
  }

  /**
   * Place Stop Loss and Take Profit orders
   */
  private async placeSLTP(position: Position): Promise<void> {
    const isLong = position.side === PositionSide.LONG;
    const quantity = this.roundQuantity(position.size / position.entry, position.symbol);

    try {
      // Place Stop Loss (opposite side)
      const slSide: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
      await this.binance.placeStopLoss(
        position.symbol,
        slSide,
        quantity,
        position.stopLoss
      );

      // Place Take Profit (opposite side)
      const tpSide: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
      await this.binance.placeTakeProfit(
        position.symbol,
        tpSide,
        quantity,
        position.takeProfit
      );

      logger.info('TradeExecutor', `SL/TP orders placed for ${position.symbol}`, {
        sl: position.stopLoss,
        tp: position.takeProfit
      });

    } catch (error: any) {
      logger.error('TradeExecutor', 'Failed to place SL/TP', error.message);
    }
  }

  /**
   * Close position manually (e.g. signal reversal or emergency)
   * Race condition fix: Cancel orders first, then check if position exists
   */
  public async closePosition(
    position: Position,
    reason: TradeExitReason
  ): Promise<void> {
    try {
      const isLong = position.side === PositionSide.LONG;
      const side: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';

      // 1. FIRST Check for existing SL/TP to determine if we should cancel first
      const openOrders = await this.binance.getOpenOrders(position.symbol);

      // Правка: Приводим тип к string, чтобы избежать ошибки TypeScript о непересекающихся типах
      const hasSLTP = openOrders.some(o => {
        const t = o.type as string;
        return t === 'STOP_MARKET' || t === 'TAKE_PROFIT_MARKET' || t.includes('STOP') || t.includes('PROFIT');
      });

      if (hasSLTP) {
        await this.cancelAllOrders(position.symbol);
        await Helpers.sleep(200);
      }

      // 2. Check quantity via position risk (avoid LOT_SIZE errors on closing remnants)
      const posRisk = await this.binance.getPositionRisk(position.symbol);

      // If position amt is 0, it was already closed (likely by SL/TP or liquidation)
      if (!posRisk || Math.abs(posRisk.positionAmt) === 0) {
        logger.warn('TradeExecutor', `Position ${position.symbol} already closed on exchange`);

        // Get accurate exit price from history
        const trades = await this.binance.getUserTrades(position.symbol, 3);
        const lastTrade = trades.sort((a, b) => b.time - a.time)[0];
        const exitPrice = lastTrade ? lastTrade.price : await this.binance.getCurrentPrice(position.symbol);
        const pnl = lastTrade ? lastTrade.realizedPnl : 0;

        // Just update DB state without sending a new order
        this.finalizePositionInDb(position, exitPrice, TradeExitReason.MANUAL, pnl);
        return;
      }

      // Use exact amount from exchange (always positive for order quantity)
      const quantity = Math.abs(posRisk.positionAmt);

      // 3. Place market order to close
      const order = await this.binance.placeMarketOrder(position.symbol, side, quantity);
      const exitPrice = order.price || posRisk.entryPrice; // Fallback to entry if price unavailable

      // 4. Update DB and Stats
      await this.finalizePositionInDb(position, exitPrice, reason);

    } catch (error: any) {
      logger.error('TradeExecutor', 'Failed to close position', error.message);
      throw error;
    }
  }

  /**
   * Helper to update DB and stats when position closes
   */
  private async finalizePositionInDb(
    position: Position,
    exitPrice: number,
    reason: TradeExitReason,
    realPnlFromExchange?: number
  ): Promise<void> {
    const isLong = position.side === PositionSide.LONG;

    let pnlValue = 0;
    let pnlPercent = 0;

    if (realPnlFromExchange !== undefined && realPnlFromExchange !== 0) {
      pnlValue = realPnlFromExchange;
      const margin = position.size / position.leverage;
      pnlPercent = (pnlValue / margin) * 100;
    } else {
      const calc = Helpers.calculatePnL(position.entry, exitPrice, position.size, isLong, position.leverage);
      pnlValue = calc.pnl;
      pnlPercent = calc.pnlPercent;
    }

    position.closeTime = Date.now();
    position.closePrice = exitPrice;
    position.pnl = pnlValue;
    position.pnlPercent = pnlPercent;
    position.status = PositionStatus.CLOSED;
    position.exitReason = reason;

    db.updatePosition(position);
    db.saveTrade({
      position,
      won: pnlValue > 0,
      rr: Helpers.calculateRR(position.entry, position.stopLoss, exitPrice, isLong),
      holdTime: position.closeTime - position.openTime,
      slippage: 0
    });

    // Note: Balance is tracked via database state, not in-memory RiskManager
    // The IRiskManager is now a pure calculator - balance updates happen in DB

    logger.trade(position.symbol, `Position finalized: ${reason}`, {
      pnl: Helpers.formatCurrency(pnlValue),
      pnlPercent: Helpers.formatPercent(pnlPercent)
    });
  }

  /**
   * Monitor open positions (Sync state with exchange)
   * FIX: No longer triggers Market Order if price hits SL/TP locally.
   * Instead, detects if exchange already closed the position.
   */
  public async monitorPositions(): Promise<void> {
    const openPositions = db.getOpenPositions();

    for (const position of openPositions) {
      try {
        // 1. Get real status from Binance
        const posRisk = await this.binance.getPositionRisk(position.symbol);

        if (!posRisk) continue;

        // 2. If position size is 0 on exchange, but OPEN in DB -> It hit SL or TP
        if (Math.abs(posRisk.positionAmt) === 0) {
          logger.info('TradeExecutor', `Position ${position.symbol} closed by Exchange (SL/TP)`);

          // Determine if it was SL or TP based on trade history
          const trades = await this.binance.getUserTrades(position.symbol, 5);
          const lastTrade = trades.sort((a, b) => b.time - a.time)[0];
          let exitPrice = 0;
          let realizedPnl = 0;

          if (lastTrade && lastTrade.time > position.openTime) {
            exitPrice = lastTrade.price;
            realizedPnl = lastTrade.realizedPnl;
          } else {
            exitPrice = await this.binance.getCurrentPrice(position.symbol);
          }

          const isLong = position.side === PositionSide.LONG;

          // Simple logic to guess reason
          let reason = TradeExitReason.MANUAL;
          if (isLong) {
            if (exitPrice <= position.stopLoss * 1.01) reason = TradeExitReason.STOP_LOSS;
            else if (exitPrice >= position.takeProfit * 0.99) reason = TradeExitReason.TAKE_PROFIT;
          } else {
            if (exitPrice >= position.stopLoss * 0.99) reason = TradeExitReason.STOP_LOSS;
            else if (exitPrice <= position.takeProfit * 1.01) reason = TradeExitReason.TAKE_PROFIT;
          }

          // Sync DB
          await this.finalizePositionInDb(position, exitPrice, reason, realizedPnl);

          // Clean up any lingering orders (just in case)
          await this.cancelAllOrders(position.symbol);
        }

        // 3. If Position is still OPEN -> Do nothing (SL/TP are handled by exchange)
        // We rely on the StrategyEngine to trigger 'closePosition' for logical exits (reversals/regime change)

      } catch (error: any) {
        logger.error('TradeExecutor', `Error monitoring position ${position.id}`, error.message);
      }
    }
  }

  /**
   * Cancel all orders for symbol
   */
  private async cancelAllOrders(symbol: string): Promise<void> {
    try {
      const openOrders = await this.binance.getOpenOrders(symbol);

      for (const order of openOrders) {
        await this.binance.cancelOrder(symbol, order.orderId);
      }
    } catch (error: any) {
      logger.warn('TradeExecutor', `Failed to cancel orders for ${symbol}`, error.message);
    }
  }

  /**
   * Round quantity to symbol's precision
   */
  private roundQuantity(quantity: number, symbol: string): number {
    const stepSize = this.binance.getStepSize(symbol);
    return Helpers.floorToStep(quantity, stepSize);
  }

  /**
   * Emergency close all positions
   */
  public async emergencyCloseAll(): Promise<void> {
    logger.error('TradeExecutor', '🚨 EMERGENCY CLOSE ALL POSITIONS');

    const openPositions = db.getOpenPositions();

    for (const position of openPositions) {
      try {
        await this.closePosition(position, TradeExitReason.MANUAL);
      } catch (error) {
        logger.error('TradeExecutor', `Failed to emergency close ${position.symbol}`);
      }
    }
  }
}