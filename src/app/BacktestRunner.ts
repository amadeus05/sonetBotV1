/**
 * Backtest Engine (Parallel / Portfolio Mode)
 * V7.6 FINAL: Logic Fixes + ALL Methods Included
 */

import { injectable, inject } from 'inversify';
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
    SignalType,
} from '../types';

import { MomentumStrategy } from '../domain/strategies/MomentumStrategy';
import { IRiskManager } from '../domain/interfaces/IRiskManager';
import { BinanceService } from '../infrastructure/exchanges/binance/BinanceService';
import { db } from '../infrastructure/persistence/DatabaseManager';
import { logger } from '../infrastructure/logging/Logger';
import { Helpers } from '../utils/Helpers';
import { config } from '../infrastructure/config/ConfigService';
import { TYPES } from '../di/types';
import * as fs from 'fs';
import * as path from 'path';
import { TradeReportExporter } from './reporting/TradeReportExporter';

// --- CONSTANTS ---
const BINANCE_TAKER_FEE = 0.0005; // 0.05%
const SLIPPAGE_PERCENT = 0.0002;  // 0.02%
const STRATEGY_LOOKBACK = 1000;   // History window

// === ANTI-COMPOUND MODE ===
// Set to true for realistic backtests (fixed position sizing based on initial balance)
// Set to false for compound growth (position sizing based on current equity)
const FIXED_POSITION_SIZE_MODE = true;

@injectable()
export class BacktestRunner {
    private binance: BinanceService;
    private walletBalance: number = 0;
    private freeBalance: number = 0;
    private lockedMargin: number = 0;
    private activePositions: Position[] = [];
    private closedTrades: TradeResult[] = [];
    private equityCurve: { timestamp: number; balance: number, equity: number }[] = [];
    private totalFeesPaid: number = 0;
    private maxRiskExposureRatio = 0.06;
    private initialBalance: number = 0; // For fixed position sizing mode

    constructor(
        @inject(TYPES.BinanceService) binance: BinanceService,
        @inject(TYPES.IRiskManager) private readonly riskManager: IRiskManager,
        @inject(TYPES.StrategyEngine) private readonly strategyEngine: MomentumStrategy
    ) {
        this.binance = binance;
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
            const currentEquity = this.calculateEquity(currentTimestamp, currentCandlesSnapshot);

            // Daily Stats
            if (currentDayStr === '') {
                currentDayStr = dateStr;
            } else if (currentDayStr !== dateStr) {
                const dailyPnL = currentEquity - startOfDayEquity;
                const dailyPercent = (dailyPnL / startOfDayEquity) * 100;
                console.log(`\n📅 Day Finished: ${currentDayStr} | PnL: ${Helpers.formatCurrency(dailyPnL)} (${dailyPercent > 0 ? '+' : ''}${dailyPercent.toFixed(2)}%) | Eq: ${Helpers.formatCurrency(currentEquity)}`);
                currentDayStr = dateStr;
                startOfDayEquity = currentEquity;
            }

            if (i % 2000 === 0) {
                const percent = ((i / timeline.length) * 100).toFixed(1);
                process.stdout.write(`\r[${percent}%] Eq: $${currentEquity.toFixed(0)} | Free: $${this.freeBalance.toFixed(0)} | Pos: ${this.activePositions.length}  `);
            }

            // === Note: Position sizing uses FIXED_POSITION_SIZE_MODE via configService.getRiskConfig().accountBalance ===
            // Strategy Engine gets balance from ConfigService, ensuring consistent sizing

            // A. Check Exits
            for (let j = this.activePositions.length - 1; j >= 0; j--) {
                const position = this.activePositions[j];
                const candle = currentCandlesSnapshot[position.symbol];

                if (!candle || candle.timestamp <= position.openTime) continue;

                const result = this.checkPositionExit(position, candle);

                if (result) {
                    this.activePositions.splice(j, 1);
                    this.closedTrades.push(result);

                    // --- FEE & BALANCE LOGIC FIX ---
                    const marginReleased = position.size / position.leverage;
                    this.lockedMargin -= marginReleased;

                    // Возвращаем на баланс: Маржа + (Чистый PnL + EntryFee который мы уже заплатили)
                    const entryFeePaid = position.size * BINANCE_TAKER_FEE;
                    const realizedPnL = result.position.pnl! + entryFeePaid;

                    const cashReturn = marginReleased + realizedPnL;

                    this.freeBalance += cashReturn;
                    this.walletBalance = this.freeBalance + this.lockedMargin;

                    const pnlStr = Helpers.formatCurrency(result.position.pnl!);
                    const emoji = result.won ? '✅' : '❌';
                    const durationMins = Math.round((result.holdTime) / 1000 / 60);
                    const durationStr = durationMins > 60 ? `${(durationMins / 60).toFixed(1)}h` : `${durationMins}m`;

                    // Note: pnlPercent here is ROI on margin (leveraged), not % of account equity
                    const isLong = position.side === PositionSide.LONG;
                    const exitPrice = position.closePrice ?? 0;
                    const notionalRoiPct = position.entry > 0
                        ? ((isLong ? (exitPrice - position.entry) : (position.entry - exitPrice)) / position.entry) * 100
                        : 0;
                    const marginRoiPct = result.position.pnlPercent ?? 0;
                    console.log(
                        `\n   ${emoji} Closed ${position.symbol} ${position.side} | PnL: ${pnlStr} ` +
                        `| ROI: ${notionalRoiPct.toFixed(2)}% notional / ${marginRoiPct.toFixed(2)}% margin ` +
                        `| Time: ${durationStr} | Reason: ${result.position.exitReason}`
                    );
                }
            }

            // B. Check Entries
            if (this.activePositions.length < maxOpenTrades) {
                for (const symbol of backtestConfig.symbols) {
                    if (this.activePositions.length >= maxOpenTrades) break;
                    if (this.activePositions.some(p => p.symbol === symbol)) continue;

                    const candle = currentCandlesSnapshot[symbol];
                    const candleIndex = cursor[symbol];
                    if (!candle || candleIndex < 200) continue;

                    const startIndex = Math.max(0, candleIndex - STRATEGY_LOOKBACK);
                    const historicalSlice = marketData[symbol].slice(startIndex, candleIndex + 1);

                    const signal = await this.simulateStrategyAnalysis(
                        symbol,
                        historicalSlice,
                        this.strategyEngine
                    );

                    if (signal) {
                        this.tryOpenPosition(signal, candle, backtestConfig, currentEquity);
                    }
                }
            }

            // C. Record Equity
            const endTickEquity = this.calculateEquity(currentTimestamp, currentCandlesSnapshot);
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
        this.saveResults(result, marketData); // JSON + HTML отчёты по сделкам
        this.displaySummary(result); // И этот тоже

        return result;
    }

    // --- EXECUTION LOGIC ---

    private tryOpenPosition(signal: TradingSignal, candle: Candle, config: BacktestConfig, currentEquity: number) {
        // === FIX: РЕАЛИСТИЧНОЕ ИСПОЛНЕНИЕ ===
        // Мы не можем открыть сделку по цене signal.entry, если текущая цена хуже.
        
        let executionPrice = signal.entry;

        if (signal.type === 'LONG') {
            // Для ЛОНГА:
            // 1. Если High свечи ниже цены входа -> цена не дошла до лимитки/стопа -> пропускаем
            if (candle.high < signal.entry) return;

            // 2. Если Open свечи ВЫШЕ цены входа (Гэп вверх) -> мы покупаем по худшей цене (по рынку)
            // Мы не можем купить по 100, если рынок открылся по 105.
            executionPrice = Math.max(signal.entry, candle.open);
        } else {
            // Для ШОРТА:
            // 1. Если Low свечи выше цены входа -> цена не дошла -> пропускаем
            if (candle.low > signal.entry) return;

            // 2. Если Open свечи НИЖЕ цены входа (Гэп вниз) -> мы продаем по худшей цене (по рынку)
            // Мы не можем продать по 100, если рынок уже упал на 95.
            executionPrice = Math.min(signal.entry, candle.open);
        }

        // Добавим проскальзывание (Slippage) на вход, например 0.05%
        // Для лонга цена выше, для шорта ниже
        const slippage = executionPrice * 0.0005; 
        if (signal.type === 'LONG') executionPrice += slippage;
        else executionPrice -= slippage;

        const maxGap = config.risk.maxGapEntryPercent;
        if (
            Helpers.adverseEntryFraction(
                signal.type === SignalType.LONG,
                signal.entry,
                executionPrice
            ) > maxGap
        ) {
            return;
        }

        // =====================================

        const leverage = config.risk.leverage;
        const isLong = signal.type === SignalType.LONG;
        const { stopLoss: adjustedStopLoss, takeProfit: adjustedTakeProfit } =
            Helpers.shiftStopsToExecutionPrice(
                isLong,
                signal.entry,
                signal.stopLoss,
                signal.takeProfit,
                executionPrice
            );
        const positionSizeUSDT = Helpers.scalePositionSizeForExecution(
            signal.entry,
            signal.positionSize,
            executionPrice
        );

        const marginRequired = positionSizeUSDT / leverage;
        const entryFee = positionSizeUSDT * 0.0005; // 0.05% fee

        if (this.freeBalance < (marginRequired + entryFee)) return;

        let currentRiskExposure = 0;
        for (const pos of this.activePositions) {
            currentRiskExposure += (Math.abs(pos.entry - pos.stopLoss) / pos.entry) * pos.size;
        }
        
        const newTradeRisk = (Math.abs(executionPrice - adjustedStopLoss) / executionPrice) * positionSizeUSDT;
        if ((currentRiskExposure + newTradeRisk) > currentEquity * this.maxRiskExposureRatio) return;

        const position: Position = {
            id: Helpers.generateId(),
            symbol: signal.symbol,
            side: isLong ? PositionSide.LONG : PositionSide.SHORT,
            entry: executionPrice,
            size: positionSizeUSDT,
            leverage: leverage,
            stopLoss: adjustedStopLoss,
            takeProfit: adjustedTakeProfit,
            openTime: candle.timestamp,
            status: PositionStatus.OPEN,
            tags: signal.tags
        };

        // Fee deducted ONCE here
        this.freeBalance -= (marginRequired + entryFee);
        this.lockedMargin += marginRequired;
        this.walletBalance = this.freeBalance + this.lockedMargin;
        this.totalFeesPaid += entryFee;

        const date = new Date(candle.timestamp);
        const readableTime = date.toISOString().replace('T', ' ').substring(0, 19);
        
        // Логируем разницу, если она была существенной
        const slipLog = Math.abs(executionPrice - signal.entry) > (signal.entry * 0.001) 
            ? ` (Slipped: ${signal.entry.toFixed(2)} -> ${executionPrice.toFixed(2)})` 
            : '';

        console.log(`\n🔥 OPEN TRADE [${readableTime}] ${signal.symbol} ${signal.type} @ ${executionPrice.toFixed(4)}${slipLog}`);
        this.activePositions.push(position);
    }

    // --- CHECK EXIT (Classic SL/TP) ---
    private checkPositionExit(position: Position, currentCandle: Candle): TradeResult | null {
        const isLong = position.side === PositionSide.LONG;
        let exitReason: TradeExitReason | null = null;
        let exitPrice = 0;
        let isLiquidation = false;

        // 1. LIQUIDATION
        const liqPriceLong = position.entry * (1 - (1 / position.leverage) + 0.005);
        const liqPriceShort = position.entry * (1 + (1 / position.leverage) - 0.005);

        if (isLong && currentCandle.low <= liqPriceLong) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = liqPriceLong; isLiquidation = true; }
        else if (!isLong && currentCandle.high >= liqPriceShort) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = liqPriceShort; isLiquidation = true; }

        // 2. SL / TP (Standard)
        if (!exitReason) {
            const hitSL_Long = currentCandle.low <= position.stopLoss;
            const hitTP_Long = currentCandle.high >= position.takeProfit;
            const hitSL_Short = currentCandle.high >= position.stopLoss;
            const hitTP_Short = currentCandle.low <= position.takeProfit;

            if (isLong) {
                if (hitSL_Long) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = position.stopLoss * (1 - SLIPPAGE_PERCENT); }
                else if (hitTP_Long) { exitReason = TradeExitReason.TAKE_PROFIT; exitPrice = position.takeProfit; }
            } else {
                if (hitSL_Short) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = position.stopLoss * (1 + SLIPPAGE_PERCENT); }
                else if (hitTP_Short) { exitReason = TradeExitReason.TAKE_PROFIT; exitPrice = position.takeProfit; }
            }
        }

        if (!exitReason) return null;

        // 3. RESULT CALCULATION
        let rawPnL = 0;
        let exitFee = 0;

        if (isLiquidation) {
            const marginLocked = position.size / position.leverage;
            rawPnL = -marginLocked;
            exitFee = 0;
        } else {
            const pnlResult = Helpers.calculatePnL(position.entry, exitPrice, position.size, isLong, position.leverage);
            rawPnL = pnlResult.pnl;
            const exitNotional = position.size * (exitPrice / position.entry);
            exitFee = exitNotional * BINANCE_TAKER_FEE;
            this.totalFeesPaid += exitFee;
        }

        const entryFeePaid = position.size * BINANCE_TAKER_FEE;
        const totalNetPnL = rawPnL - exitFee - entryFeePaid;

        position.closeTime = currentCandle.timestamp;
        position.closePrice = exitPrice;
        position.pnl = totalNetPnL;
        const marginUsed = position.size / position.leverage;
        position.pnlPercent = isLiquidation ? -100 : (totalNetPnL / marginUsed) * 100;
        position.status = PositionStatus.CLOSED;
        position.exitReason = isLiquidation ? TradeExitReason.STOP_LOSS : exitReason;

        const rr = isLiquidation ? 0 : Helpers.calculateRR(position.entry, position.stopLoss, exitPrice, isLong);

        return {
            position,
            won: totalNetPnL > 0,
            rr,
            holdTime: position.closeTime - position.openTime,
            slippage: isLiquidation ? 0 : Math.abs(position.stopLoss - exitPrice)
        };
    }

    private calculateEquity(timestamp: number, currentPrices: Record<string, Candle>): number {
        let equity = this.walletBalance;
        for (const pos of this.activePositions) {
            const candle = currentPrices[pos.symbol];
            if (candle) {
                const currentPrice = candle.close;
                const isLong = pos.side === PositionSide.LONG;
                const pnlData = Helpers.calculatePnL(pos.entry, currentPrice, pos.size, isLong, pos.leverage);
                const currentNotional = pos.size * (currentPrice / pos.entry);
                const estExitFee = currentNotional * BINANCE_TAKER_FEE;
                equity += (pnlData.pnl - estExitFee);
            }
        }
        return equity;
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
            averageRR: 0,
            profitFactor,
            finalBalance: finalEquity,
            totalPnL,
            totalPnLPercent: (totalPnL / config.initialBalance) * 100,
            maxDrawdown: maxDD.amount,
            maxDrawdownPercent: maxDD.percent,
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

    private async fetchHistoricalData(symbol: string, startDate: Date, endDate: Date): Promise<Candle[]> {
        const timeframe = config.getConfig().timeframe;
        const startTime = startDate.getTime();
        const endTime = endDate.getTime();

        const timeframeMs = this.timeframeToMs(timeframe);

        // 1) Пытаемся взять из БД, но ТОЛЬКО если диапазон действительно покрыт и нет явных дыр.
        const cached = db.getCandles(symbol, timeframe, startTime, endTime);
        const cacheLooksComplete = cached.length > 0 && db.hasDataForRange(symbol, timeframe, startTime, endTime);
        if (cacheLooksComplete && this.isCandleSeriesSane(cached, timeframeMs)) {
            console.log(`✅ [DB] ${symbol}: Using cached candles (${cached.length}).`);
            return cached;
        } else if (cached.length > 0) {
            console.log(`⚠️ [DB] ${symbol}: Cache exists (${cached.length}) but выглядит неполным/битым. Перекачиваю диапазон...`);
        }

        // Если в базе пусто (length === 0) — тогда качаем
        if (cached.length === 0) console.log(`ℹ️ [DB] ${symbol}: No data found. Downloading from API...`);

        // --- БЛОК СКАЧИВАНИЯ ---
        const allCandles: Candle[] = [];
        let currentTime = startTime;
        const klineLimit = 1000;

        while (currentTime < endTime) {
            await Helpers.sleep(50);
            const candles = await this.binance.getCandles(symbol, timeframe, klineLimit, currentTime);
            if (candles.length === 0) break;

            const mergedCandles = candles.map(c => ({ ...c }));

            const filtered = mergedCandles.filter(c => c.timestamp >= startTime && c.timestamp <= endTime);
            allCandles.push(...filtered);

            if (candles.length < klineLimit) break;
            const lastCandleTime = candles[candles.length - 1].timestamp;
            if (lastCandleTime >= endTime) break;
            currentTime = lastCandleTime + timeframeMs;
        }

        const sorted = allCandles.sort((a, b) => a.timestamp - b.timestamp);
        const deduped = this.dedupeCandlesByTimestamp(sorted)
            .filter(c => c.timestamp >= startTime && c.timestamp <= endTime)
            .sort((a, b) => a.timestamp - b.timestamp);

        // Сохраняем скачанное (ОБЯЗАТЕЛЬНО должен быть INSERT OR REPLACE в db)
        if (deduped.length > 0) {
            db.saveCandles(symbol, timeframe, deduped);
        }

        return deduped;
    }

    private timeframeToMs(timeframe: string): number {
        const tf = (timeframe || '').trim();
        const match = tf.match(/^(\d+)([mhdw])$/i);
        if (!match) return 0;
        const value = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (!Number.isFinite(value) || value <= 0) return 0;
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'w': return value * 7 * 24 * 60 * 60 * 1000;
            default: return 0;
        }
    }

    private dedupeCandlesByTimestamp(candles: Candle[]): Candle[] {
        if (candles.length <= 1) return candles;
        const map = new Map<number, Candle>();
        for (const c of candles) map.set(c.timestamp, c); // last wins
        return Array.from(map.values());
    }

    private isCandleSeriesSane(candles: Candle[], timeframeMs: number): boolean {
        if (candles.length < 2) return true;

        // Must be strictly non-decreasing by timestamp.
        for (let i = 1; i < candles.length; i++) {
            if (candles[i].timestamp < candles[i - 1].timestamp) return false;
        }

        // If timeframe is known, detect obvious gaps/duplicates.
        if (timeframeMs > 0) {
            for (let i = 1; i < candles.length; i++) {
                const dt = candles[i].timestamp - candles[i - 1].timestamp;
                if (dt === 0) return false; // duplicate timestamp in series (should not happen after DB ORDER BY)
                // allow multi-step gaps (weekends etc don't exist in crypto), but it's still a red flag:
                if (dt % timeframeMs !== 0) return false;
                // if there is a large gap, consider cache suspicious (missing candles)
                if (dt > timeframeMs * 2) return false;
            }
        }
        return true;
    }

    private async simulateStrategyAnalysis(symbol: string, candles: Candle[], strategy: MomentumStrategy): Promise<TradingSignal | null> {

        const marketData = {
            symbol,
            candles: candles,
            lastPrice: candles[candles.length - 1].close,
        };
        return await strategy.analyze(marketData);
    }

    // --- UTILS ---
    private saveResults(result: BacktestResult, marketData?: Record<string, Candle[]>): void {
        const resultsDir = './backtest-results';
        if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.writeFileSync(path.join(resultsDir, `backtest-${timestamp}.json`), JSON.stringify(result, null, 2));

        // Генерация автономных HTML-отчётов по каждой сделке (100 свечей до/после + entry/tp/sl)
        try {
            if (marketData && result.trades?.length) {
                const tradesDir = path.join(resultsDir, `backtest-${timestamp}-trades`);
                const timeframe = config.getConfig().timeframe;
                TradeReportExporter.exportAll(result.trades, marketData, {
                    outputDir: tradesDir,
                    timeframe,
                    candlesBefore: 100,
                    candlesAfter: 100,
                });
            }
        } catch (e) {
            logger.warn('Backtest', 'Не удалось сгенерировать HTML-отчёты по сделкам', e);
        }
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
        console.log(`   Sharpe: ${result.sharpeRatio.toFixed(2)}\n`);

        this.displayPerSymbolStats();
    }

    private displayPerSymbolStats(): void {
        if (this.closedTrades.length === 0) {
            console.log('🪙 Статистика по монетам: нет сделок.\n');
            return;
        }

        type SymbolStats = {
            symbol: string;
            trades: number;
            wins: number;
            tp: number;
            sl: number;
            pnl: number;
        };

        const statsBySymbol = new Map<string, SymbolStats>();

        for (const trade of this.closedTrades) {
            const symbol = trade.position.symbol;
            const exitReason = trade.position.exitReason;
            const pnl = trade.position.pnl ?? 0;

            const current = statsBySymbol.get(symbol) ?? { symbol, trades: 0, wins: 0, tp: 0, sl: 0, pnl: 0 };
            current.trades += 1;
            if (trade.won) current.wins += 1;
            current.pnl += pnl;

            if (exitReason === TradeExitReason.TAKE_PROFIT) current.tp += 1;
            else if (exitReason === TradeExitReason.STOP_LOSS) current.sl += 1;

            statsBySymbol.set(symbol, current);
        }

        const ranked = Array.from(statsBySymbol.values()).sort((a, b) => b.pnl - a.pnl);

        const formatPnl = (value: number) => {
            const abs = Helpers.formatCurrency(Math.abs(value));
            return value >= 0 ? `+${abs}` : `-${abs}`;
        };

        const pad = (s: string, width: number, align: 'left' | 'right' = 'left') => {
            const str = s ?? '';
            if (str.length >= width) return str;
            const spaces = ' '.repeat(width - str.length);
            return align === 'right' ? `${spaces}${str}` : `${str}${spaces}`;
        };

        const headers = ['Rank', 'Symbol', 'Trades', 'TP', 'SL', 'WinRate%', 'PnL'];
        const rows = ranked.map((s, idx) => ([
            String(idx + 1),
            s.symbol,
            String(s.trades),
            String(s.tp),
            String(s.sl),
            `${((s.wins / Math.max(1, s.trades)) * 100).toFixed(1)}%`,
            formatPnl(s.pnl),
        ]));

        const colWidths = headers.map((h, colIdx) => {
            const maxCell = Math.max(h.length, ...rows.map(r => r[colIdx].length));
            // небольшой запас для читабельности
            return Math.min(Math.max(maxCell + 2, h.length + 2), 32);
        });

        const line = '─'.repeat(colWidths.reduce((sum, w) => sum + w, 0) + (headers.length - 1) * 1);
        console.log('🪙 Статистика по монетам (рейтинг по PnL):');
        console.log(line);
        console.log(headers.map((h, i) => pad(h, colWidths[i], i === 1 ? 'left' : 'right')).join(' '));
        console.log(line);

        for (const row of rows) {
            console.log(row.map((c, i) => pad(c, colWidths[i], i === 1 ? 'left' : 'right')).join(' '));
        }

        console.log(line + '\n');
    }
}
