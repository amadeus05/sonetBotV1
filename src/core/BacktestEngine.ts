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
import { db } from '../services/DatabaseManager';
import { logger } from '../services/Logger';
import { Helpers } from '../utils/Helpers';
import { config } from '../config/ConfigManager';
import * as fs from 'fs';
import * as path from 'path';

// --- CONSTANTS ---
const BINANCE_TAKER_FEE = 0.0005; // 0.05%
const SLIPPAGE_PERCENT = 0.0002;  // 0.02%
const STRATEGY_LOOKBACK = 1000;   // History window

// === ANTI-COMPOUND MODE ===
// Set to true for realistic backtests (fixed position sizing based on initial balance)
// Set to false for compound growth (position sizing based on current equity)
const FIXED_POSITION_SIZE_MODE = true;

export class BacktestEngine {
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

    constructor() {
        this.binance = new BinanceService();
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

            // === CRITICAL: Use initial balance in FIXED mode to prevent unrealistic compound growth ===
            const balanceForSizing = FIXED_POSITION_SIZE_MODE ? this.initialBalance : currentEquity;
            (riskManager as any).currentBalance = balanceForSizing;

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
                        strategyEngine
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
        this.saveResults(result); // Теперь этот метод точно существует
        this.displaySummary(result); // И этот тоже

        return result;
    }

    // --- EXECUTION LOGIC ---

    private tryOpenPosition(signal: TradingSignal, candle: Candle, config: BacktestConfig, currentEquity: number) {
        const leverage = config.risk.leverage;
        const positionSizeUSDT = signal.positionSize;
        const marginRequired = positionSizeUSDT / leverage;
        const entryFee = positionSizeUSDT * BINANCE_TAKER_FEE;

        if (this.freeBalance < (marginRequired + entryFee)) return;

        let currentRiskExposure = 0;
        for (const pos of this.activePositions) {
            currentRiskExposure += (Math.abs(pos.entry - pos.stopLoss) / pos.entry) * pos.size;
        }
        const newTradeRisk = (Math.abs(signal.entry - signal.stopLoss) / signal.entry) * positionSizeUSDT;
        if ((currentRiskExposure + newTradeRisk) > currentEquity * this.maxRiskExposureRatio) return;

        const position: Position = {
            id: Helpers.generateId(),
            symbol: signal.symbol,
            side: signal.type === 'LONG' ? PositionSide.LONG : PositionSide.SHORT,
            entry: signal.entry,
            size: positionSizeUSDT,
            leverage: leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
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
        console.log(`\n🔥 OPEN TRADE [${readableTime}] ${signal.symbol} ${signal.type} @ ${signal.entry} (Conf: ${signal.confidence.toFixed(2)})`);
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

        // 1. ПРОСТОЙ ЗАПРОС В БАЗУ
        // Пытаемся достать данные за указанный период (можно добавить запас tolerance, если хотите)
        // Но даже строгий запрос подойдет, если данные там есть.
        const cached = db.getCandles(symbol, timeframe, startTime, endTime);

        // 2. ЖЕЛЕЗНАЯ ЛОГИКА: ЕСТЬ ДАННЫЕ -> БЕРЕМ
        // Мы не проверяем, хватает ли их полностью, нет ли дырок.
        // Если массив не пустой — отдаем его.
        if (cached.length > 0) {
            console.log(`✅ [DB] ${symbol}: Found ${cached.length} candles. Using DB.`);
            return cached;
        }

        // Если в базе пусто (length === 0) — тогда качаем
        console.log(`ℹ️ [DB] ${symbol}: No data found. Downloading from API...`);

        // --- БЛОК СКАЧИВАНИЯ ---
        const allCandles: Candle[] = [];
        let currentTime = startTime;
        const klineLimit = 1000;
        
        // Перевод таймфрейма в мс для итерации
        let timeframeMs = 60000; 
        if (timeframe === '5m') timeframeMs = 300000;
        if (timeframe === '15m') timeframeMs = 900000;
        if (timeframe === '1h') timeframeMs = 3600000;
        
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

        // Сохраняем скачанное (ОБЯЗАТЕЛЬНО должен быть INSERT OR REPLACE в db)
        if (sorted.length > 0) {
            db.saveCandles(symbol, timeframe, sorted);
        }

        return sorted;
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
        console.log(`   Sharpe: ${result.sharpeRatio.toFixed(2)}\n`);
    }
}