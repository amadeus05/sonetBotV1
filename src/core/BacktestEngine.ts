/**
 * Backtest Engine (Parallel / Portfolio Mode)
 * V7.6 FINAL: Logic Fixes + ALL Methods Included
 */

import {
    Candle,
    BacktestConfig,
    BacktestResult,
    Position,
    PositionStatus,
    PositionSide,
    TradeExitReason,
    TradeResult,
    TradingSignal,
} from '../types';

import { StrategyEngine } from './StrategyEngine';
import { RiskManager } from './RiskManager';
import { BinanceService } from '../services/BinanceService';
import { ExchangeContract } from '../services/contracts/ExchangeContract';
import { db } from '../services/DatabaseManager';
import { logger } from '../services/Logger';
import { Helpers } from '../utils/Helpers';
import { config } from '../config/ConfigManager';
import { TechnicalIndicators } from '../utils/TechnicalIndicators';
import * as fs from 'fs';
import * as path from 'path';

// --- CONSTANTS ---
const SLIPPAGE_PERCENT = 0.0002;  // 0.02% base slippage
const STRATEGY_LOOKBACK = 1200;   // History window

// Strategy regime filters (must match StrategyEngine RR-driven constraints)
const ATR_PERIOD = 14;
const ATR_AVG_PERIOD = 50;
const VOLUME_SMA_PERIOD = 20;
const ATR_FILTER_MULT = 1.05;
const VOLUME_FILTER_MULT = 1.1;

// === ANTI-COMPOUND MODE ===
// Set to true for realistic backtests (fixed position sizing based on initial balance)
// Set to false for compound growth (position sizing based on current equity)
// NOTE: For this project requirements we want compounding sizing from current equity
const FIXED_POSITION_SIZE_MODE = true;

export class BacktestEngine {
    private exchange: ExchangeContract;
    private walletBalance: number = 0;
    private freeBalance: number = 0;
    private lockedMargin: number = 0;
    private activePositions: Position[] = [];
    private closedTrades: TradeResult[] = [];
    private equityCurve: { timestamp: number; balance: number, equity: number }[] = [];
    private totalFeesPaid: number = 0;
    private maxRiskExposureRatio = 0.08; // Increased slightly for flex
    private initialBalance: number = 0;

    constructor(exchange?: ExchangeContract) {
        this.exchange = exchange ?? new BinanceService();
    }

    private takerFee(): number {
        return config.getConfig().fees?.taker ?? 0.0005;
    }

    public async run(backtestConfig: BacktestConfig): Promise<BacktestResult> {
        logger.info('Backtest', '🧪 Starting V7.6 (Fixed & Complete) backtest...', {
            symbols: backtestConfig.symbols.join(', '),
            initialBalance: backtestConfig.initialBalance
        });

        // 1. Initialize Account
        this.initialBalance = backtestConfig.initialBalance;
        this.walletBalance = backtestConfig.initialBalance;
        this.freeBalance = backtestConfig.initialBalance;
        this.lockedMargin = 0;

        logger.info('Backtest', `Position sizing mode: ${FIXED_POSITION_SIZE_MODE ? 'FIXED (realistic)' : 'COMPOUND (growth)'}`);

        this.closedTrades = [];
        this.activePositions = [];
        this.totalFeesPaid = 0;

        this.equityCurve = [{
            timestamp: backtestConfig.startDate.getTime(),
            balance: this.walletBalance,
            equity: this.walletBalance
        }];

        const riskManager = new RiskManager(backtestConfig.initialBalance);
        riskManager.setBacktestPositions(this.activePositions);
        const strategyEngine = new StrategyEngine(riskManager);

        // 2. Load Data
        const marketData = await this.fetchAllMarketData(backtestConfig);
        if (Object.keys(marketData).length === 0) throw new Error("No market data fetched");

        // 3. Create Timeline
        const allTimestamps = new Set<number>();
        for (const symbol in marketData) {
            marketData[symbol].forEach(c => allTimestamps.add(c.timestamp));
        }
        const timeline = Array.from(allTimestamps).sort((a, b) => a - b);
        const cursor: Record<string, number> = {};
        backtestConfig.symbols.forEach(s => cursor[s] = 0);

        logger.info('Backtest', `Timeline Steps: ${timeline.length}`);

        let currentDayStr = '';
        let startOfDayEquity = this.walletBalance;

        // === MAIN LOOP ===
        for (let i = 0; i < timeline.length; i++) {
            const currentTimestamp = timeline[i];
            const maxOpenTrades = backtestConfig.risk.maxOpenTrades;
            const dateStr = new Date(currentTimestamp).toISOString().split('T')[0];

            const currentCandlesSnapshot = this.getSnapshot(marketData, cursor, currentTimestamp);
            // IMPORTANT: At candle open we must NOT use close/high/low for sizing (no look-ahead).
            // We mark-to-market using OPEN prices for start-of-candle equity.
            const startTickEquity = this.calculateEquity(currentTimestamp, currentCandlesSnapshot, 'open');

            // Daily Stats
            if (currentDayStr === '') {
                currentDayStr = dateStr;
            } else if (currentDayStr !== dateStr) {
                const endOfPrevTickEquity = this.equityCurve.length > 0
                    ? this.equityCurve[this.equityCurve.length - 1].equity
                    : startOfDayEquity;
                const dailyPnL = endOfPrevTickEquity - startOfDayEquity;
                const dailyPercent = (dailyPnL / startOfDayEquity) * 100;
                console.log(`\n📅 Day Finished: ${currentDayStr} | PnL: ${Helpers.formatCurrency(dailyPnL)} (${dailyPercent > 0 ? '+' : ''}${dailyPercent.toFixed(2)}%) | Eq: ${Helpers.formatCurrency(endOfPrevTickEquity)}`);
                currentDayStr = dateStr;
                startOfDayEquity = endOfPrevTickEquity;
            }

            if (i % 2000 === 0) {
                const percent = ((i / timeline.length) * 100).toFixed(1);
                process.stdout.write(`\r[${percent}%] Eq: $${startTickEquity.toFixed(0)} | Free: $${this.freeBalance.toFixed(0)} | Pos: ${this.activePositions.length}  `);
            }

            // --- UPDATE BALANCE FOR RISK MANAGER (Compounding support) ---
            (riskManager as any).currentBalance = startTickEquity;
            riskManager.setBacktestPositions(this.activePositions);

            // A. Generate Signals strictly on CLOSE of candle (i-1),
            // then execute entry strictly on OPEN of current candle i.
            // This avoids look-ahead bias when candle timestamps are openTime (Binance kline[0]).
            if (this.activePositions.length < maxOpenTrades) {
                for (const symbol of backtestConfig.symbols) {
                    if (this.activePositions.length >= maxOpenTrades) break;
                    if (this.activePositions.some(p => p.symbol === symbol)) continue;
                    if (!riskManager.canOpenPosition()) break;

                    const candle = currentCandlesSnapshot[symbol]; // current candle i (OPEN event)
                    const candleIndex = cursor[symbol];            // index of candle i
                    const prevIndex = candleIndex - 1;             // candle (i-1) is fully closed now

                    // Need at least one previous candle to generate a signal
                    if (!candle || prevIndex < 0) continue;
                    if (prevIndex < STRATEGY_LOOKBACK) continue; // Warm-up check on closed candle

                    const startIndex = Math.max(0, prevIndex - STRATEGY_LOOKBACK + 1);
                    const historicalSlice = marketData[symbol].slice(startIndex, prevIndex + 1); // ends at (i-1)

                    const signal = await this.simulateStrategyAnalysis(
                        symbol,
                        historicalSlice,
                        strategyEngine
                    );

                    if (signal) {
                        // Entry at OPEN of current candle i (which is i = prevIndex+1)
                        const prevCandle = marketData[symbol][prevIndex];
                        this.executeEntry(signal, candle, backtestConfig, startTickEquity, prevCandle);
                    } else {
                        // TEMP DEBUG: Log rejections
                        // console.log(`[NO SIGNAL] ${symbol} @ ${new Date(historicalSlice.at(-1)!.timestamp).toISOString()}`);
                    }
                }
            }

            // B. Check Exits for positions opened before this candle (OHLC constraint)
            for (let j = this.activePositions.length - 1; j >= 0; j--) {
                const position = this.activePositions[j];
                const candle = currentCandlesSnapshot[position.symbol];

                if (!candle) continue;

                // --- RULE: No exit in the same candle it opened ---
                if (candle.timestamp <= position.openTime) continue;

                // Cache remaining notional BEFORE exit logic mutates the position (partials / final close)
                const notionalBeforeExit = (position.remainingSize ?? position.size);

                // NOTE: Regime filter (ATR/Volume) is ENTRY-ONLY filter.
                // Once in position, we don't force-exit due to regime change.
                // Exit is handled by SL/TP/Trailing only.

                const result = this.checkPositionExit(position, candle);

                if (result) {
                    this.activePositions.splice(j, 1);
                    this.closedTrades.push(result);

                    const marginReleased = notionalBeforeExit / position.leverage;
                    this.lockedMargin -= marginReleased;

                    // Net PnL already includes fees in this implementation
                    // IMPORTANT: with partial exits, realizedPnL was already credited earlier.
                    // So for cashflow at final close we only return remaining-leg PnL (+ released margin).
                    const cashPnLForClose = (result.position.meta?.cashPnLForClose ?? result.position.pnl) as number;
                    const cashReturn = marginReleased + cashPnLForClose;
                    this.freeBalance += cashReturn;
                    this.walletBalance = this.freeBalance + this.lockedMargin;

                    const pnlStr = Helpers.formatCurrency(result.position.pnl!);
                    const emoji = result.won ? '✅' : '❌';
                    console.log(`\n   ${emoji} Closed ${position.symbol} ${position.side} | PnL: ${pnlStr} | Reason: ${result.position.exitReason}`);
                }
                else {
                    // Update trailing stop and other management AFTER exit checks (conservative bar-by-bar)
                    this.updatePositionManagement(position, candle);
                }
            }

            // C. Record end-of-candle equity using CLOSE prices (end of simulation step)
            const endTickEquity = this.calculateEquity(currentTimestamp, currentCandlesSnapshot, 'close');
            this.equityCurve.push({
                timestamp: currentTimestamp,
                balance: this.walletBalance,
                equity: endTickEquity
            });

            if (endTickEquity <= 0) {
                console.log('\n💀 BANKRUPTCY! Equity reached 0.');
                break;
            }
        }

        console.log('\nSimulation finished.');
        const result = this.calculateResults(backtestConfig);
        this.saveResults(result); // Теперь этот метод точно существует
        this.displaySummary(result); // И этот тоже

        return result;
    }

    // --- EXECUTION LOGIC ---

    private estimateEntrySlippagePercent(prevCandle: Candle): number {
        // Realistic-ish slippage: use previous candle range (known at entry time) + base slippage
        const prevRangePct = prevCandle.open > 0 ? Math.abs(prevCandle.high - prevCandle.low) / prevCandle.open : 0;
        const rangeComponent = prevRangePct * 0.10; // take 10% of the previous candle range
        // cap to avoid insane fills on wild candles
        return Math.min(0.003, Math.max(SLIPPAGE_PERCENT, rangeComponent));
    }

    private executeEntry(signal: TradingSignal, currentCandle: Candle, config: BacktestConfig, currentEquity: number, prevCandleForSlippage: Candle) {
        const isLong = signal.type === 'LONG';

        // --- RULE: Entry ONLY at OPEN of i+1 with slippage ---
        const entrySlip = this.estimateEntrySlippagePercent(prevCandleForSlippage);
        const entryPrice = isLong
            ? currentCandle.open * (1 + entrySlip)
            : currentCandle.open * (1 - entrySlip);

        const leverage = config.risk.leverage;
        const positionSizeUSDT = signal.positionSize; // Already calculated by RiskManager based on current balance
        const marginRequired = positionSizeUSDT / leverage;
        const entryFee = positionSizeUSDT * this.takerFee();

        if (this.freeBalance < (marginRequired + entryFee)) {
            console.log(`⚠️ Entry skipped: Insufficient balance for ${signal.symbol}. Needs ${Helpers.formatCurrency(marginRequired + entryFee)}`);
            return;
        }

        // Global risk check
        let currentRiskExposure = 0;
        for (const pos of this.activePositions) {
            const notional = (pos.remainingSize ?? pos.size);
            currentRiskExposure += (Math.abs(pos.entry - pos.stopLoss) / pos.entry) * notional;
        }

        // --- RR-driven execution: recompute SL/TP/TP1 from actual fill price using volatility distance ---
        const meta = (signal.metadata ?? {}) as any;
        const stopDistance = Number.isFinite(meta.stopDistance) ? meta.stopDistance : Math.abs(signal.entry - signal.stopLoss);
        const rr = Number.isFinite(meta.rr) ? meta.rr : 1.4;
        const tp1R = Number.isFinite(meta.tp1R) ? meta.tp1R : 1.0;
        const tp1Fraction = Number.isFinite(meta.tp1Fraction) ? meta.tp1Fraction : 0.7;
        const trailingDistance = Number.isFinite(meta.trailingDistance) ? meta.trailingDistance : stopDistance;

        const stopLoss = isLong ? entryPrice - stopDistance : entryPrice + stopDistance;
        const takeProfit = isLong ? entryPrice + (stopDistance * rr) : entryPrice - (stopDistance * rr);
        const tp1Price = isLong ? entryPrice + (stopDistance * tp1R) : entryPrice - (stopDistance * tp1R);

        const newTradeRisk = (Math.abs(entryPrice - stopLoss) / entryPrice) * positionSizeUSDT;
        if ((currentRiskExposure + newTradeRisk) > currentEquity * this.maxRiskExposureRatio) return;

        const position: Position = {
            id: Helpers.generateId(),
            symbol: signal.symbol,
            side: isLong ? PositionSide.LONG : PositionSide.SHORT,
            entry: entryPrice,
            size: positionSizeUSDT,
            quantity: positionSizeUSDT / entryPrice,
            leverage: leverage,
            stopLoss,
            takeProfit,
            initialSize: positionSizeUSDT,
            remainingSize: positionSizeUSDT,
            initialStopLoss: stopLoss,
            tp1Price,
            tp1Fraction,
            partialTaken: false,
            realizedPnL: 0,
            trailingActive: false,
            trailingDistance,
            trailingStop: undefined,
            trailingAnchor: undefined,
            breakEvenPrice: entryPrice,
            meta: { ...meta },
            openTime: currentCandle.timestamp,
            status: PositionStatus.OPEN,
            tags: signal.tags
        };

        this.freeBalance -= (marginRequired + entryFee);
        this.lockedMargin += marginRequired;
        this.walletBalance = this.freeBalance + this.lockedMargin;
        this.totalFeesPaid += entryFee;

        const date = new Date(currentCandle.timestamp);
        const readableTime = date.toISOString().replace('T', ' ').substring(0, 19);
        console.log(`\n🔥 OPEN TRADE [${readableTime}] ${signal.symbol} ${signal.type} @ ${entryPrice.toFixed(2)} (Signal @ ${signal.entry.toFixed(2)} | slip ${(entrySlip * 100).toFixed(3)}%)`);
        this.activePositions.push(position);
    }

    // --- CHECK EXIT (Classic SL/TP) ---
    private checkPositionExit(position: Position, currentCandle: Candle): TradeResult | null {
        const isLong = position.side === PositionSide.LONG;
        let exitReason: TradeExitReason | null = null;
        let exitPrice = 0;
        let isLiquidation = false;

        const notionalRemaining = (position.remainingSize ?? position.size);
        if (notionalRemaining <= 0) return null;

        // Effective stop includes trailing stop if active (but trailing is updated only after the candle closes)
        let effectiveStop = position.stopLoss;
        if (position.trailingActive && Number.isFinite(position.trailingStop)) {
            effectiveStop = isLong
                ? Math.max(effectiveStop, position.trailingStop!)
                : Math.min(effectiveStop, position.trailingStop!);
        }

        // 1. LIQUIDATION CHECK (Estimated)
        const maintenanceMargin = 0.005; // 0.5%
        const liqPriceLong = position.entry * (1 - (1 / position.leverage) + maintenanceMargin);
        const liqPriceShort = position.entry * (1 + (1 / position.leverage) - maintenanceMargin);

        if (isLong && currentCandle.low <= liqPriceLong) {
            exitReason = TradeExitReason.STOP_LOSS;
            exitPrice = liqPriceLong;
            isLiquidation = true;
        }
        else if (!isLong && currentCandle.high >= liqPriceShort) {
            exitReason = TradeExitReason.STOP_LOSS;
            exitPrice = liqPriceShort;
            isLiquidation = true;
        }

        // 2. SL / TP (Standard with SL priority)
        if (!exitReason) {
            const hitSL_Long = currentCandle.low <= effectiveStop;
            const hitTP_Long = currentCandle.high >= position.takeProfit;
            const hitSL_Short = currentCandle.high >= effectiveStop;
            const hitTP_Short = currentCandle.low <= position.takeProfit;

            if (isLong) {
                if (hitSL_Long) {
                    exitReason = TradeExitReason.STOP_LOSS;
                    exitPrice = effectiveStop * (1 - SLIPPAGE_PERCENT);
                }
            } else {
                if (hitSL_Short) {
                    exitReason = TradeExitReason.STOP_LOSS;
                    exitPrice = effectiveStop * (1 + SLIPPAGE_PERCENT);
                }
            }
        }

        // 2.1 Partial exit at 1R (70%) - only if SL not hit in this candle (SL priority)
        if (!exitReason && !position.partialTaken && Number.isFinite(position.tp1Price) && (position.tp1Fraction ?? 0) > 0) {
            const tp1 = position.tp1Price!;
            const hitTP1_Long = currentCandle.high >= tp1;
            const hitTP1_Short = currentCandle.low <= tp1;

            if ((isLong && hitTP1_Long) || (!isLong && hitTP1_Short)) {
                this.executePartialTP1(position, currentCandle);
                // Теперь мы не делаем return null сразу, а даем коду шанс закрыться по полному TP в той же свече
            }
        }

        // 2.2 Final TP (1.4R) for remaining - after TP1 logic
        if (!exitReason) {
            const hitTP_Long = currentCandle.high >= position.takeProfit;
            const hitTP_Short = currentCandle.low <= position.takeProfit;
            if (isLong && hitTP_Long) {
                exitReason = TradeExitReason.TAKE_PROFIT;
                exitPrice = position.takeProfit * (1 - SLIPPAGE_PERCENT);
            } else if (!isLong && hitTP_Short) {
                exitReason = TradeExitReason.TAKE_PROFIT;
                exitPrice = position.takeProfit * (1 + SLIPPAGE_PERCENT);
            }
        }

        if (!exitReason) return null;

        // 3. RESULT CALCULATION
        let rawPnL = 0;
        let exitFee = 0;
        const takerFee = this.takerFee();

        if (isLiquidation) {
            const marginLocked = notionalRemaining / position.leverage;
            rawPnL = -marginLocked;
            exitFee = 0;
        } else {
            const pnlResult = Helpers.calculatePnL(position.entry, exitPrice, notionalRemaining, isLong, position.leverage);
            rawPnL = pnlResult.pnl;
            const exitNotional = notionalRemaining * (exitPrice / position.entry);
            exitFee = exitNotional * takerFee;
            this.totalFeesPaid += exitFee;
        }

        // IMPORTANT: entry fee is already charged at entry time (freeBalance -= entryFee).
        // Do NOT subtract it again here, otherwise fees are double-counted.
        const remainingLegNetPnL = rawPnL - exitFee;
        const realized = position.realizedPnL ?? 0;
        const totalNetPnL = realized + remainingLegNetPnL;

        position.closeTime = currentCandle.timestamp;
        position.closePrice = exitPrice;
        position.pnl = totalNetPnL;
        const marginUsed = (position.initialSize ?? position.size) / position.leverage;
        position.pnlPercent = isLiquidation ? -100 : (totalNetPnL / marginUsed) * 100;
        position.status = PositionStatus.CLOSED;
        position.exitReason = isLiquidation ? TradeExitReason.STOP_LOSS : exitReason;
        position.remainingSize = 0;
        position.meta = {
            ...(position.meta ?? {}),
            realizedPnL: realized,
            remainingLegNetPnL,
            cashPnLForClose: remainingLegNetPnL,
        };

        // Achieved RR (fee-aware, supports partials): totalNetPnL / initialRisk$
        const initialNotional = (position.initialSize ?? position.size);
        const initialSL = position.initialStopLoss ?? position.stopLoss;
        const initialRiskDollar = initialNotional * (Math.abs(position.entry - initialSL) / position.entry);
        const rr = (isLiquidation || initialRiskDollar <= 0) ? 0 : (totalNetPnL / initialRiskDollar);

        return {
            position,
            won: totalNetPnL > 0,
            rr,
            holdTime: position.closeTime - position.openTime,
            slippage: isLiquidation ? 0 : Math.abs(position.stopLoss - exitPrice)
        };
    }

    private calculateEquity(timestamp: number, currentPrices: Record<string, Candle>, priceField: 'open' | 'close' = 'close'): number {
        let equity = this.walletBalance;
        for (const pos of this.activePositions) {
            const candle = currentPrices[pos.symbol];
            if (candle) {
                const currentPrice = priceField === 'open' ? candle.open : candle.close;
                const isLong = pos.side === PositionSide.LONG;
                const notional = (pos.remainingSize ?? pos.size);
                const pnlData = Helpers.calculatePnL(pos.entry, currentPrice, notional, isLong, pos.leverage);
                const currentNotional = notional * (currentPrice / pos.entry);
                const estExitFee = currentNotional * this.takerFee();
                equity += (pnlData.pnl - estExitFee);
            }
        }
        return equity;
    }

    private executePartialTP1(position: Position, candle: Candle): void {
        const isLong = position.side === PositionSide.LONG;
        const initialNotional = (position.initialSize ?? position.size);
        const remainingNotional = (position.remainingSize ?? position.size);
        const fraction = position.tp1Fraction ?? 0.7;
        const partialNotional = Math.min(remainingNotional, initialNotional * fraction);
        if (partialNotional <= 0) return;

        const leverage = position.leverage;
        const marginReleased = partialNotional / leverage;

        // adverse slippage on exit (market)
        const target = position.tp1Price!;
        const exitPrice = isLong ? target * (1 - SLIPPAGE_PERCENT) : target * (1 + SLIPPAGE_PERCENT);

        const pnlResult = Helpers.calculatePnL(position.entry, exitPrice, partialNotional, isLong, position.leverage);
        const rawPnL = pnlResult.pnl;

        const exitNotional = partialNotional * (exitPrice / position.entry);
        const fee = exitNotional * this.takerFee();
        this.totalFeesPaid += fee;

        const net = rawPnL - fee;

        // Realize partial
        position.realizedPnL = (position.realizedPnL ?? 0) + net;
        position.remainingSize = remainingNotional - partialNotional;
        position.partialTaken = true;

        // Release margin + credit realized PnL
        this.lockedMargin -= marginReleased;
        this.freeBalance += (marginReleased + net);
        this.walletBalance = this.freeBalance + this.lockedMargin;

        // Move stop to BE, activate trailing
        position.stopLoss = position.breakEvenPrice ?? position.entry;
        position.trailingActive = true;
        // Initialize trailing on next candle management update (avoid intra-candle look-ahead)
        if (!Number.isFinite(position.trailingAnchor)) {
            position.trailingAnchor = position.entry;
        }
        if (!Number.isFinite(position.trailingStop)) {
            position.trailingStop = position.stopLoss;
        }
    }

    private updatePositionManagement(position: Position, candle: Candle): void {
        // Update trailing AFTER we already checked exits for this candle (conservative, avoids look-ahead)
        if (!position.trailingActive || !Number.isFinite(position.trailingDistance)) return;
        const isLong = position.side === PositionSide.LONG;

        const anchor = Number.isFinite(position.trailingAnchor)
            ? position.trailingAnchor!
            : position.entry;

        const newAnchor = isLong ? Math.max(anchor, candle.high) : Math.min(anchor, candle.low);
        position.trailingAnchor = newAnchor;

        const dist = position.trailingDistance!;
        const newTrail = isLong ? (newAnchor - dist) : (newAnchor + dist);
        position.trailingStop = newTrail;
    }

    private computeRegimeFilters(candles: Candle[]): { atrOk: boolean; volOk: boolean } {
        if (!candles || candles.length < 260) return { atrOk: false, volOk: false };

        const atrSeries = TechnicalIndicators.atr(candles, ATR_PERIOD);
        if (atrSeries.length < ATR_AVG_PERIOD) return { atrOk: false, volOk: false };

        const currentATR = atrSeries[atrSeries.length - 1];
        const atrAvg50 = TechnicalIndicators.sma(atrSeries.slice(-ATR_AVG_PERIOD), ATR_AVG_PERIOD)[0];
        const atrOk = currentATR >= (atrAvg50 * ATR_FILTER_MULT);

        const volSma = TechnicalIndicators.volumeAverage(candles, VOLUME_SMA_PERIOD);
        if (volSma.length === 0) return { atrOk, volOk: false };

        const volSma20 = volSma[volSma.length - 1];
        const last = candles[candles.length - 1];
        const volRatio = volSma20 > 0 ? (last.volume / volSma20) : 0;
        const volOk = volRatio >= VOLUME_FILTER_MULT;

        return { atrOk, volOk };
    }

    private forceExitOnOpen(position: Position, candle: Candle, reason: TradeExitReason): TradeResult {
        const isLong = position.side === PositionSide.LONG;
        const notionalRemaining = (position.remainingSize ?? position.size);
        const openFill = isLong ? candle.open * (1 - SLIPPAGE_PERCENT) : candle.open * (1 + SLIPPAGE_PERCENT);

        const pnlResult = Helpers.calculatePnL(position.entry, openFill, notionalRemaining, isLong, position.leverage);
        const rawPnL = pnlResult.pnl;

        const exitNotional = notionalRemaining * (openFill / position.entry);
        const fee = exitNotional * this.takerFee();
        this.totalFeesPaid += fee;
        const remainingLegNetPnL = rawPnL - fee;

        const realized = position.realizedPnL ?? 0;
        const totalNetPnL = realized + remainingLegNetPnL;

        position.closeTime = candle.timestamp;
        position.closePrice = openFill;
        position.pnl = totalNetPnL;
        const marginUsed = (position.initialSize ?? position.size) / position.leverage;
        position.pnlPercent = marginUsed > 0 ? (totalNetPnL / marginUsed) * 100 : 0;
        position.status = PositionStatus.CLOSED;
        position.exitReason = reason;
        position.remainingSize = 0;
        position.meta = {
            ...(position.meta ?? {}),
            realizedPnL: realized,
            remainingLegNetPnL,
            cashPnLForClose: remainingLegNetPnL,
        };

        const initialNotional = (position.initialSize ?? position.size);
        const initialSL = position.initialStopLoss ?? position.stopLoss;
        const initialRiskDollar = initialNotional * (Math.abs(position.entry - initialSL) / position.entry);
        const rr = initialRiskDollar > 0 ? (totalNetPnL / initialRiskDollar) : 0;

        return {
            position,
            won: totalNetPnL > 0,
            rr,
            holdTime: position.closeTime - position.openTime,
            slippage: Math.abs(candle.open - openFill)
        };
    }

    private getSnapshot(data: Record<string, Candle[]>, cursor: Record<string, number>, timestamp: number): Record<string, Candle> {
        const snapshot: Record<string, Candle> = {};
        for (const symbol in data) {
            const candles = data[symbol];
            while (cursor[symbol] < candles.length - 1 && candles[cursor[symbol] + 1].timestamp <= timestamp) {
                cursor[symbol]++;
            }
            if (candles[cursor[symbol]].timestamp === timestamp) {
                snapshot[symbol] = candles[cursor[symbol]];
            }
        }
        return snapshot;
    }

    private calculateResults(config: BacktestConfig): BacktestResult {
        const results = this.closedTrades;
        const wins = results.filter(r => r.won);
        const losses = results.filter(r => !r.won);
        const finalEquity = this.equityCurve.length > 0 ? this.equityCurve[this.equityCurve.length - 1].equity : config.initialBalance;
        const totalPnL = finalEquity - config.initialBalance;

        const grossProfit = wins.reduce((sum, r) => sum + r.position.pnl!, 0);
        const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r.position.pnl!, 0));
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);

        const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
        const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
        const winRate = results.length > 0 ? (wins.length / results.length) * 100 : 0;
        const averageRR = results.length > 0
            ? results.reduce((sum, r) => sum + (Number.isFinite(r.rr) ? r.rr : 0), 0) / results.length
            : 0;

        // Expectancy = (WinRate * AvgWin) - (LossRate * AvgLoss)
        const lossRate = 1 - (wins.length / results.length);
        const expectancy = results.length > 0
            ? ((wins.length / results.length) * avgWin) - (lossRate * avgLoss)
            : 0;

        const returns = this.equityCurve.map((point, i) => {
            if (i === 0) return 0;
            const prev = this.equityCurve[i - 1].equity;
            return ((point.equity - prev) / prev) * 100;
        });

        const equities = this.equityCurve.map(p => p.equity);
        const maxDD = Helpers.maxDrawdown(equities);

        return {
            totalTrades: results.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate,
            averageWin: avgWin,
            averageLoss: avgLoss,
            averageRR,
            profitFactor,
            finalBalance: finalEquity,
            totalPnL,
            totalPnLPercent: (totalPnL / config.initialBalance) * 100,
            maxDrawdown: maxDD.amount,
            maxDrawdownPercent: maxDD.percent,
            expectancy: expectancy,
            sharpeRatio: Helpers.sharpeRatio(returns),
            trades: results,
            equityCurve: this.equityCurve
        };
    }

    private async fetchAllMarketData(config: BacktestConfig): Promise<Record<string, Candle[]>> {
        const data: Record<string, Candle[]> = {};
        logger.info('Backtest', 'Fetching historical data (Klines + Open Interest)...');
        for (const symbol of config.symbols) {
            process.stdout.write(`Fetching ${symbol}... `);
            const candles = await this.fetchHistoricalData(symbol, config.startDate, config.endDate);
            if (candles.length > 0) {
                data[symbol] = candles;
                const hasOI = candles.some(c => c.openInterest && c.openInterest > 0);
                console.log(`OK (${candles.length} candles)${hasOI ? ' [OI Data Included]' : ' [No OI Data]'}`);
            } else { console.log(`FAIL`); }
        }
        console.log('');
        return data;
    }

    private getTimeframeMs(timeframe: string): number {
        const map: Record<string, number> = {
            '1m': 60_000,
            '3m': 180_000,
            '5m': 300_000,
            '15m': 900_000,
            '30m': 1_800_000,
            '1h': 3_600_000,
            '4h': 14_400_000,
            '1d': 86_400_000,
        };

        return map[timeframe] || 300_000;
    }

    private sanitizeCandles(candles: Candle[]): Candle[] {
        if (candles.length === 0) return [];

        const byTimestamp = new Map<number, Candle>();

        for (const candle of candles) {
            const values = [
                candle.timestamp,
                candle.open,
                candle.high,
                candle.low,
                candle.close,
                candle.volume,
                candle.takerBuyBaseVolume ?? 0,
                candle.openInterest ?? 0,
            ];

            const hasBadValue = values.some(v => !Number.isFinite(v));
            const hasBadRange = candle.timestamp <= 0 ||
                candle.open <= 0 ||
                candle.high <= 0 ||
                candle.low <= 0 ||
                candle.close <= 0 ||
                candle.volume < 0 ||
                candle.low > candle.high ||
                candle.open < candle.low ||
                candle.open > candle.high ||
                candle.close < candle.low ||
                candle.close > candle.high;

            if (hasBadValue || hasBadRange) continue;

            byTimestamp.set(candle.timestamp, {
                timestamp: candle.timestamp,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
                takerBuyBaseVolume: candle.takerBuyBaseVolume || 0,
                openInterest: candle.openInterest || 0,
            });
        }

        return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
    }

    private analyzeCandleIntegrity(candles: Candle[], timeframe: string, startTime: number, endTime: number): {
        valid: boolean;
        reason?: string;
        missingCount: number;
        cleaned: Candle[];
    } {
        const cleaned = this.sanitizeCandles(candles);
        const timeframeMs = this.getTimeframeMs(timeframe);

        if (cleaned.length === 0) {
            return { valid: false, reason: 'empty dataset', missingCount: 0, cleaned };
        }

        for (let i = 1; i < cleaned.length; i++) {
            if (cleaned[i].timestamp <= cleaned[i - 1].timestamp) {
                return {
                    valid: false,
                    reason: `non-chronological candles around ${cleaned[i - 1].timestamp} -> ${cleaned[i].timestamp}`,
                    missingCount: 0,
                    cleaned
                };
            }
        }

        let missingCount = 0;
        for (let i = 1; i < cleaned.length; i++) {
            const diff = cleaned[i].timestamp - cleaned[i - 1].timestamp;
            if (diff > timeframeMs) {
                missingCount += Math.floor(diff / timeframeMs) - 1;
            }
        }

        if (missingCount > 0) {
            return {
                valid: false,
                reason: `detected ${missingCount} missing candles`,
                missingCount,
                cleaned
            };
        }

        const expectedFirst = Math.ceil(startTime / timeframeMs) * timeframeMs;
        const expectedLast = endTime >= timeframeMs
            ? Math.floor((endTime - timeframeMs) / timeframeMs) * timeframeMs
            : -1;
        const hasOutOfRange = cleaned[0].timestamp < expectedFirst || cleaned[cleaned.length - 1].timestamp > expectedLast;
        if (hasOutOfRange) {
            return {
                valid: false,
                reason: 'dataset contains candles outside requested range',
                missingCount,
                cleaned
            };
        }

        if (expectedLast >= expectedFirst) {
            if (cleaned[0].timestamp !== expectedFirst) {
                return {
                    valid: false,
                    reason: `missing leading candles (expected first ${expectedFirst}, got ${cleaned[0].timestamp})`,
                    missingCount,
                    cleaned
                };
            }

            if (cleaned[cleaned.length - 1].timestamp !== expectedLast) {
                return {
                    valid: false,
                    reason: `missing trailing candles (expected last ${expectedLast}, got ${cleaned[cleaned.length - 1].timestamp})`,
                    missingCount,
                    cleaned
                };
            }
        }

        return { valid: true, missingCount, cleaned };
    }

    private async fetchHistoricalData(symbol: string, startDate: Date, endDate: Date): Promise<Candle[]> {
        const timeframe = config.getConfig().timeframe;
        const startTime = startDate.getTime();
        const endTime = endDate.getTime();
        const timeframeMs = this.getTimeframeMs(timeframe);

        const cached = db.getCandles(symbol, timeframe, startTime, endTime);
        const cachedAudit = this.analyzeCandleIntegrity(cached, timeframe, startTime, endTime);

        if (cachedAudit.valid) {
            console.log(`✅ [DB] ${symbol}: Found ${cachedAudit.cleaned.length} candles. Integrity OK.`);
            return cachedAudit.cleaned;
        } else if (cached.length > 0) {
            console.log(`⚠️ [DB] ${symbol}: Cache rejected (${cachedAudit.reason}). Re-downloading range...`);
        }

        if (cached.length === 0) {
            console.log(`ℹ️ [DB] ${symbol}: No data found. Downloading from API...`);
        }

        const allCandles: Candle[] = [];
        let currentTime = startTime;
        const klineLimit = 1000;

        while (currentTime < endTime) {
            await Helpers.sleep(50);
            const candles = await this.exchange.getCandles(symbol, timeframe, klineLimit, currentTime, endTime);
            if (candles.length === 0) break;

            const mergedCandles = candles
                .map(c => ({ ...c }))
                .filter(c => c.timestamp >= startTime && (c.timestamp + timeframeMs) <= endTime);

            allCandles.push(...mergedCandles);

            if (candles.length < klineLimit) break;
            const lastCandleTime = candles[candles.length - 1].timestamp;
            if (lastCandleTime >= endTime) break;
            currentTime = lastCandleTime + timeframeMs;
        }

        const sorted = this.sanitizeCandles(allCandles);
        const downloadedAudit = this.analyzeCandleIntegrity(sorted, timeframe, startTime, endTime);

        if (!downloadedAudit.valid) {
            throw new Error(`Historical data integrity failed for ${symbol}: ${downloadedAudit.reason}`);
        }

        if (downloadedAudit.cleaned.length > 0) {
            db.saveCandles(symbol, timeframe, downloadedAudit.cleaned);
        }

        return downloadedAudit.cleaned;
    }

    private async simulateStrategyAnalysis(symbol: string, candles: Candle[], strategy: StrategyEngine): Promise<TradingSignal | null> {

        const marketData = {
            symbol,
            candles: candles,
            lastPrice: candles[candles.length - 1].close,
        };
        return await strategy.analyze(marketData);
    }

    // --- UTILS ---
    private saveResults(result: BacktestResult): void {
        const resultsDir = './backtest-results';
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(resultsDir, `backtest-${timestamp}.json`), JSON.stringify(result, null, 2));
    }

    private displaySummary(result: BacktestResult): void {
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log('║           PORTFOLIO BACKTEST RESULTS (V7.6 FINAL)         ║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');
        console.log(`📊 Trades: ${result.totalTrades} (W: ${result.winningTrades} / L: ${result.losingTrades})`);
        console.log(`   Win Rate: ${result.winRate.toFixed(2)}%`);
        console.log(`💰 Equity:`);
        console.log(`   Start: ${Helpers.formatCurrency(this.equityCurve[0].equity)}`);
        console.log(`   End:   ${Helpers.formatCurrency(result.finalBalance)}`);
        console.log(`   PnL:   ${Helpers.formatCurrency(result.totalPnL)} (${result.totalPnLPercent.toFixed(2)}%)`);
        console.log(`   Fees:  ${Helpers.formatCurrency(this.totalFeesPaid)}`);
        console.log(`📉 Risk:`);
        console.log(`   Max DD: ${result.maxDrawdownPercent.toFixed(2)}%`);
        console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}`);
        console.log(`   Expectancy: ${Helpers.formatCurrency(result.expectancy ?? 0)}`);
        console.log(`   Sharpe: ${result.sharpeRatio.toFixed(2)}\n`);

        // --- SUMMARY TABLE BY COIN ---
        const statsBySymbol = new Map<string, { trades: number, wins: number, pnl: number, tpCount: number, slCount: number }>();

        for (const trade of result.trades) {
            const symbol = trade.position.symbol;
            const stats = statsBySymbol.get(symbol) || { trades: 0, wins: 0, pnl: 0, tpCount: 0, slCount: 0 };
            stats.trades++;
            if (trade.won) stats.wins++;
            stats.pnl += trade.position.pnl || 0;

            if (trade.position.exitReason === TradeExitReason.TAKE_PROFIT) stats.tpCount++;
            if (trade.position.exitReason === TradeExitReason.STOP_LOSS) stats.slCount++;

            statsBySymbol.set(symbol, stats);
        }

        if (statsBySymbol.size > 0) {
            console.log('📊 Summary by Coin:');
            console.log('┌──────────────┬────────┬────────┬────────┬──────────┬─────────────┐');
            console.log('│ Symbol       │ Trades │ TP     │ SL     │ Winrate  │ PnL         │');
            console.log('├──────────────┼────────┼────────┼────────┼──────────┼─────────────┤');

            const sortedSymbols = Array.from(statsBySymbol.keys()).sort();
            for (const symbol of sortedSymbols) {
                const stats = statsBySymbol.get(symbol)!;
                const winRate = (stats.wins / stats.trades) * 100;
                const pnlStr = Helpers.formatCurrency(stats.pnl);
                console.log(`│ ${symbol.padEnd(12)} │ ${stats.trades.toString().padStart(6)} │ ${stats.tpCount.toString().padStart(6)} │ ${stats.slCount.toString().padStart(6)} │ ${winRate.toFixed(1).padStart(7)}% │ ${pnlStr.padStart(11)} │`);
            }

            console.log('└──────────────┴────────┴────────┴────────┴──────────┴─────────────┘\n');
        }

        // --- MONTHLY PERFORMANCE TABLE ---
        const monthlyStats = new Map<string, number>();
        for (const trade of result.trades) {
            const date = new Date(trade.position.closeTime || trade.position.openTime);
            const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            monthlyStats.set(key, (monthlyStats.get(key) || 0) + (trade.position.pnl || 0));
        }

        if (monthlyStats.size > 0) {
            console.log('📅 Monthly Performance:');
            console.log('┌─────────────┬─────────────┐');
            console.log('│ Month       │ PnL         │');
            console.log('├─────────────┼─────────────┤');

            const sortedMonths = Array.from(monthlyStats.keys()).sort();
            for (const month of sortedMonths) {
                const pnl = monthlyStats.get(month)!;
                const pnlStr = Helpers.formatCurrency(pnl);
                const color = pnl >= 0 ? '🟢' : '🔴';
                console.log(`│ ${month.padEnd(11)} │ ${pnlStr.padStart(11)} ${color} │`);
            }
            console.log('└─────────────┴─────────────┘\n');
        }

        const monthlyTradeStats = new Map<string, { pnl: number, trades: number, wins: number, losses: number }>();
        const sideStats = new Map<PositionSide, { trades: number, wins: number, losses: number, pnl: number }>();

        for (const trade of result.trades) {
            const date = new Date(trade.position.closeTime || trade.position.openTime);
            const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;

            const monthStats = monthlyTradeStats.get(monthKey) || { pnl: 0, trades: 0, wins: 0, losses: 0 };
            monthStats.pnl += trade.position.pnl || 0;
            monthStats.trades++;
            if (trade.won) monthStats.wins++;
            else monthStats.losses++;
            monthlyTradeStats.set(monthKey, monthStats);

            const side = trade.position.side;
            const directionStats = sideStats.get(side) || { trades: 0, wins: 0, losses: 0, pnl: 0 };
            directionStats.trades++;
            directionStats.pnl += trade.position.pnl || 0;
            if (trade.won) directionStats.wins++;
            else directionStats.losses++;
            sideStats.set(side, directionStats);
        }

        if (monthlyTradeStats.size > 0) {
            console.log('📅 Monthly Performance Extended:');
            console.log('┌─────────────┬─────────────┬────────┬────────┬────────┐');
            console.log('│ Month       │ PnL         │ Total  │ Wins   │ Losses │');
            console.log('├─────────────┼─────────────┼────────┼────────┼────────┤');

            const sortedMonths = Array.from(monthlyTradeStats.keys()).sort();
            for (const month of sortedMonths) {
                const stats = monthlyTradeStats.get(month)!;
                const pnlStr = Helpers.formatCurrency(stats.pnl);
                console.log(`│ ${month.padEnd(11)} │ ${pnlStr.padStart(11)} │ ${stats.trades.toString().padStart(6)} │ ${stats.wins.toString().padStart(6)} │ ${stats.losses.toString().padStart(6)} │`);
            }

            console.log('└─────────────┴─────────────┴────────┴────────┴────────┘\n');
        }

        if (sideStats.size > 0) {
            console.log('📈 Long / Short Summary:');
            console.log('┌─────────────┬────────┬────────┬────────┬─────────────┐');
            console.log('│ Direction   │ Total  │ Wins   │ Losses │ PnL         │');
            console.log('├─────────────┼────────┼────────┼────────┼─────────────┤');

            for (const side of [PositionSide.LONG, PositionSide.SHORT]) {
                const stats = sideStats.get(side);
                if (!stats) continue;

                const label = side === PositionSide.LONG ? 'LONG' : 'SHORT';
                const pnlStr = Helpers.formatCurrency(stats.pnl);
                console.log(`│ ${label.padEnd(11)} │ ${stats.trades.toString().padStart(6)} │ ${stats.wins.toString().padStart(6)} │ ${stats.losses.toString().padStart(6)} │ ${pnlStr.padStart(11)} │`);
            }

            console.log('└─────────────┴────────┴────────┴────────┴─────────────┘\n');
        }
    }
}
