/**
 * Trade Executor
 * Responsibility: Execute trades, manage positions, handle SL/TP
 */

import {
    TradingSignal,
    Position,
    PositionStatus,
    PositionSide,
    TradeExitReason,
    SignalType
  } from '../types';
  import { BinanceService } from '../services/BinanceService';
  import { RiskManager } from './RiskManager';
  import { db } from '../services/DatabaseManager';
  import { logger } from '../services/Logger';
  import { Helpers } from '../utils/Helpers';
  import { config } from '../config/ConfigManager';
  
  export class TradeExecutor {
    private binance: BinanceService;
    private riskManager: RiskManager;
  
    constructor(binance: BinanceService, riskManager: RiskManager) {
      this.binance = binance;
      this.riskManager = riskManager;
    }
  
    /**
     * Execute a trading signal
     */
    public async executeSignal(signal: TradingSignal): Promise<Position | null> {
      // Check if we can open new position
      if (!this.riskManager.canOpenPosition()) {
        logger.warn('TradeExecutor', 'Cannot open new position - risk limits reached');
        return null;
      }
  
      try {
        const { symbol, type, entry, stopLoss, takeProfit, positionSize } = signal;
        const isLong = type === SignalType.LONG;
        const side: 'BUY' | 'SELL' = isLong ? 'BUY' : 'SELL';
  
        // Calculate quantity
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
  
        // Create position
        const position: Position = {
          id: Helpers.generateId(),
          symbol,
          side: isLong ? PositionSide.LONG : PositionSide.SHORT,
          entry: order.price || entry,
          size: order.quantity * (order.price || entry),
          leverage: config.getRiskConfig().leverage,
          stopLoss,
          takeProfit,
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
        // Position is still open but without protection - handle manually
      }
    }
  
    /**
     * Close position manually
     */
    public async closePosition(
      position: Position,
      reason: TradeExitReason
    ): Promise<void> {
      try {
        const isLong = position.side === PositionSide.LONG;
        const side: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
        const quantity = this.roundQuantity(position.size / position.entry, position.symbol);
  
        // Get current price
        const currentPrice = await this.binance.getCurrentPrice(position.symbol);
  
        // Place market order to close
        const order = await this.binance.placeMarketOrder(position.symbol, side, quantity);
  
        // Calculate PnL
        const exitPrice = order.price || currentPrice;
        const pnl = Helpers.calculatePnL(
          position.entry,
          exitPrice,
          position.size,
          isLong,
          position.leverage
        );
  
        // Update position
        position.closeTime = Date.now();
        position.closePrice = exitPrice;
        position.pnl = pnl.pnl;
        position.pnlPercent = pnl.pnlPercent;
        position.status = PositionStatus.CLOSED;
        position.exitReason = reason;
  
        // Save to database
        db.updatePosition(position);
        db.saveTrade({
          position,
          won: pnl.pnl > 0,
          rr: Helpers.calculateRR(position.entry, position.stopLoss, exitPrice, isLong),
          holdTime: position.closeTime - position.openTime,
          slippage: 0
        });
  
        // Update risk manager balance
        this.riskManager.updateBalance(pnl.pnl);
  
        // Cancel any remaining orders
        await this.cancelAllOrders(position.symbol);
  
        logger.trade(position.symbol, `Position closed: ${reason}`, {
          pnl: Helpers.formatCurrency(pnl.pnl),
          pnlPercent: Helpers.formatPercent(pnl.pnlPercent),
          holdTime: Helpers.timeDiff(position.openTime, position.closeTime!)
        });
  
      } catch (error: any) {
        logger.error('TradeExecutor', 'Failed to close position', error.message);
        throw error;
      }
    }
  
    /**
     * Monitor open positions (check SL/TP hit)
     */
    public async monitorPositions(): Promise<void> {
      const openPositions = db.getOpenPositions();
  
      for (const position of openPositions) {
        try {
          const currentPrice = await this.binance.getCurrentPrice(position.symbol);
          const isLong = position.side === PositionSide.LONG;
  
          // Check if SL hit
          if (isLong && currentPrice <= position.stopLoss) {
            await this.closePosition(position, TradeExitReason.STOP_LOSS);
          } else if (!isLong && currentPrice >= position.stopLoss) {
            await this.closePosition(position, TradeExitReason.STOP_LOSS);
          }
  
          // Check if TP hit
          if (isLong && currentPrice >= position.takeProfit) {
            await this.closePosition(position, TradeExitReason.TAKE_PROFIT);
          } else if (!isLong && currentPrice <= position.takeProfit) {
            await this.closePosition(position, TradeExitReason.TAKE_PROFIT);
          }
  
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
      // Most futures have 3 decimal places, but adjust as needed
      return Helpers.roundTo(quantity, 3);
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