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
        
        // 1. FIRST Cancel existing SL/TP orders to prevent double execution
        await this.cancelAllOrders(position.symbol);

        // 2. Check quantity via position risk (avoid LOT_SIZE errors on closing remnants)
        const posRisk = await this.binance.getPositionRisk(position.symbol);
        
        // If position amt is 0, it was already closed (likely by SL/TP or liquidation)
        if (!posRisk || Math.abs(posRisk.positionAmt) === 0) {
            logger.warn('TradeExecutor', `Position ${position.symbol} already closed on exchange`);
            // Just update DB state without sending a new order
            this.finalizePositionInDb(position, position.entry, TradeExitReason.MANUAL); 
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
    private async finalizePositionInDb(position: Position, exitPrice: number, reason: TradeExitReason): Promise<void> {
        const isLong = position.side === PositionSide.LONG;
        
        const pnl = Helpers.calculatePnL(
            position.entry,
            exitPrice,
            position.size,
            isLong,
            position.leverage
        );

        position.closeTime = Date.now();
        position.closePrice = exitPrice;
        position.pnl = pnl.pnl;
        position.pnlPercent = pnl.pnlPercent;
        position.status = PositionStatus.CLOSED;
        position.exitReason = reason;

        db.updatePosition(position);
        db.saveTrade({
            position,
            won: pnl.pnl > 0,
            rr: Helpers.calculateRR(position.entry, position.stopLoss, exitPrice, isLong),
            holdTime: position.closeTime - position.openTime,
            slippage: 0
        });

        this.riskManager.updateBalance(pnl.pnl);

        logger.trade(position.symbol, `Position finalized: ${reason}`, {
            pnl: Helpers.formatCurrency(pnl.pnl),
            pnlPercent: Helpers.formatPercent(pnl.pnlPercent)
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
            
            // Determine if it was SL or TP based on current price
            // (Approximation, since we don't have the exact execution price here without querying order history)
            const currentPrice = await this.binance.getCurrentPrice(position.symbol);
            const isLong = position.side === PositionSide.LONG;
            
            // Simple logic to guess reason
            let reason = TradeExitReason.MANUAL;
            if (isLong) {
                if (currentPrice <= position.stopLoss * 1.01) reason = TradeExitReason.STOP_LOSS;
                else if (currentPrice >= position.takeProfit * 0.99) reason = TradeExitReason.TAKE_PROFIT;
            } else {
                if (currentPrice >= position.stopLoss * 0.99) reason = TradeExitReason.STOP_LOSS;
                else if (currentPrice <= position.takeProfit * 1.01) reason = TradeExitReason.TAKE_PROFIT;
            }

            // Sync DB
            await this.finalizePositionInDb(position, currentPrice, reason);
            
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