/**
 * Backtest Engine
 * Responsibility: Test strategy on historical data
 * UPDATED: Added Binance Fees (0.05%) & Slippage simulation
 */

import { 
    Candle, 
    BacktestConfig, 
    BacktestResult, 
    Position,
    PositionStatus,
    PositionSide,
    TradeExitReason,
    TradeResult
  } from '../types';
  import { StrategyEngine } from '../core/StrategyEngine';
  import { RiskManager } from '../core/RiskManager';
  import { BinanceService } from '../services/BinanceService';
  import { logger } from '../services/Logger';
  import { Helpers } from '../utils/Helpers';
  import { config } from '../config/ConfigManager';
  import * as fs from 'fs';
  import * as path from 'path';
  
  // --- КОНСТАНТЫ КОМИССИЙ И ПРОСКАЛЬЗЫВАНИЯ ---
  const BINANCE_TAKER_FEE = 0.0005; // 0.05% (Стандартная комиссия Taker)
  const ESTIMATED_SLIPPAGE = 0.0002; // 0.02% (Симуляция проскальзывания при входе/выходе)
  const TOTAL_FEE_RATE = BINANCE_TAKER_FEE + ESTIMATED_SLIPPAGE; 
  // ---------------------------------------------
  
  export class BacktestEngine {
    private binance: BinanceService;
    private results: TradeResult[] = [];
    private equityCurve: { timestamp: number; balance: number }[] = [];
    private balance: number;
    private totalFeesPaid: number = 0; // Счетчик комиссий
  
    constructor() {
      this.binance = new BinanceService();
      this.balance = 0;
    }
  
    /**
     * Run backtest
     */
    public async run(backtestConfig: BacktestConfig): Promise<BacktestResult> {
      logger.info('Backtest', '🧪 Starting backtest (with Fees & Slippage)...', {
        symbols: backtestConfig.symbols.join(', '),
        initialBalance: backtestConfig.initialBalance,
        feeRate: `${(TOTAL_FEE_RATE * 100).toFixed(2)}% per side`
      });
  
      this.balance = backtestConfig.initialBalance;
      this.results = [];
      this.totalFeesPaid = 0;
      this.equityCurve = [{ timestamp: backtestConfig.startDate.getTime(), balance: this.balance }];
  
      const riskManager = new RiskManager(backtestConfig.initialBalance);
      const strategyEngine = new StrategyEngine(riskManager);
  
      // For each symbol
      for (const symbol of backtestConfig.symbols) {
        logger.info('Backtest', `Testing ${symbol}...`);
  
        try {
          const candles = await this.fetchHistoricalData(
            symbol,
            backtestConfig.startDate,
            backtestConfig.endDate
          );
  
          if (candles.length < 200) {
            logger.warn('Backtest', `Insufficient data for ${symbol}`);
            continue;
          }
  
          await this.simulateTrading(symbol, candles, strategyEngine, riskManager);
  
        } catch (error: any) {
          logger.error('Backtest', `Error testing ${symbol}`, error.message);
        }
      }
  
      const result = this.calculateResults(backtestConfig);
      this.saveResults(result);
      this.displaySummary(result);
  
      return result;
    }
  
    private async fetchHistoricalData(
      symbol: string,
      startDate: Date,
      endDate: Date
    ): Promise<Candle[]> {
      const allCandles: Candle[] = [];
      let currentTime = startDate.getTime();
      const endTime = endDate.getTime();
      const timeframe = config.getConfig().timeframe;
      
      let timeframeMs = 300000; // 5m
      if (timeframe === '15m') timeframeMs = 900000;
      else if (timeframe === '1h') timeframeMs = 3600000;
  
      logger.info('Backtest', `Fetching data for ${symbol}...`);
  
      while (currentTime < endTime) {
        const candles = await this.binance.getCandles(symbol, timeframe, 1000, currentTime);
        if (candles.length === 0) break;
  
        const filtered = candles.filter(c => 
          c.timestamp >= startDate.getTime() && 
          c.timestamp <= endDate.getTime()
        );
  
        allCandles.push(...filtered);
        
        if (allCandles.length % 5000 === 0) process.stdout.write('.');
  
        if (candles.length < 1000) break;
        const lastCandleTime = candles[candles.length - 1].timestamp;
        if (lastCandleTime >= endTime) break;
  
        currentTime = lastCandleTime + timeframeMs;
        await Helpers.sleep(100);
      }
      console.log('');
      return allCandles.sort((a, b) => a.timestamp - b.timestamp);
    }
  
    private async simulateTrading(
      symbol: string,
      candles: Candle[],
      strategyEngine: StrategyEngine,
      riskManager: RiskManager
    ): Promise<void> {
      let openPosition: Position | null = null;
  
      for (let i = 200; i < candles.length; i++) {
        const currentCandles = candles.slice(0, i + 1);
        const currentCandle = candles[i];
  
        if (openPosition) {
          const result = this.checkPositionExit(openPosition, currentCandle);
          
          if (result) {
            this.results.push(result);
            // В checkPositionExit мы уже посчитали чистый PnL с учетом комиссии
            this.balance += result.position.pnl!;
            riskManager.updateBalance(result.position.pnl!);
            
            this.equityCurve.push({
              timestamp: currentCandle.timestamp,
              balance: this.balance
            });
  
            openPosition = null;
          }
          continue;
        }
  
        if (!riskManager.canOpenPosition()) continue;
  
        const marketData = {
          symbol,
          candles: currentCandles,
          lastPrice: currentCandle.close,
          volume24h: 0,
          priceChange24h: 0
        };
  
        const signal = await strategyEngine.analyze(marketData);
  
        if (signal) {
          openPosition = {
            id: Helpers.generateId(),
            symbol,
            side: signal.type === 'LONG' ? PositionSide.LONG : PositionSide.SHORT,
            entry: signal.entry,
            size: signal.positionSize,
            leverage: riskManager.getRiskConfig().leverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            openTime: currentCandle.timestamp,
            status: PositionStatus.OPEN,
            tags: signal.tags
          };
        }
      }
    }
  
    /**
     * Check if position should exit
     * UPDATED: Calculates Fees & Slippage
     */
    private checkPositionExit(
      position: Position,
      currentCandle: Candle
    ): TradeResult | null {
      const isLong = position.side === PositionSide.LONG;
      let exitReason: TradeExitReason | null = null;
      let exitPrice = 0;
  
      const hitSL_Long = currentCandle.low <= position.stopLoss;
      const hitTP_Long = currentCandle.high >= position.takeProfit;
      const hitSL_Short = currentCandle.high >= position.stopLoss;
      const hitTP_Short = currentCandle.low <= position.takeProfit;
  
      // Pessimistic execution logic
      if (isLong) {
          if (hitSL_Long && hitTP_Long) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = position.stopLoss; }
          else if (hitSL_Long) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = position.stopLoss; }
          else if (hitTP_Long) { exitReason = TradeExitReason.TAKE_PROFIT; exitPrice = position.takeProfit; }
      } else {
          if (hitSL_Short && hitTP_Short) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = position.stopLoss; }
          else if (hitSL_Short) { exitReason = TradeExitReason.STOP_LOSS; exitPrice = position.stopLoss; }
          else if (hitTP_Short) { exitReason = TradeExitReason.TAKE_PROFIT; exitPrice = position.takeProfit; }
      }
  
      if (!exitReason) return null;
  
      // 1. Считаем "грязный" PnL (Gross PnL)
      const rawPnL = Helpers.calculatePnL(
        position.entry,
        exitPrice,
        position.size,
        isLong,
        position.leverage
      );
  
      // 2. Считаем комиссии и проскальзывание
      // Комиссия берется от полного объема сделки (Entry + Exit)
      // Entry Volume = Size
      // Exit Volume = Size * (ExitPrice / EntryPrice) ~ Size
      const entryCost = position.size * TOTAL_FEE_RATE;
      const exitCost = (position.size * (exitPrice / position.entry)) * TOTAL_FEE_RATE;
      
      const totalTradeCost = entryCost + exitCost;
      this.totalFeesPaid += totalTradeCost; // Добавляем в общую статистику
  
      // 3. Чистый PnL (Net PnL)
      const netPnLValue = rawPnL.pnl - totalTradeCost;
      
      // Пересчитываем процент с учетом комиссий
      // Margin used = Size / Leverage
      const marginUsed = position.size / position.leverage;
      const netPnLPercent = (netPnLValue / marginUsed) * 100;
  
      position.closeTime = currentCandle.timestamp;
      position.closePrice = exitPrice;
      position.pnl = netPnLValue;       // <-- Теперь это Чистый PnL
      position.pnlPercent = netPnLPercent;
      position.status = PositionStatus.CLOSED;
      position.exitReason = exitReason;
  
      const rr = Helpers.calculateRR(position.entry, position.stopLoss, exitPrice, isLong);
  
      return {
        position,
        won: netPnLValue > 0,
        rr,
        holdTime: position.closeTime - position.openTime,
        slippage: totalTradeCost // Store cost here for reference
      };
    }
  
    private calculateResults(config: BacktestConfig): BacktestResult {
      const wins = this.results.filter(r => r.won);
      const losses = this.results.filter(r => !r.won);
  
      const totalPnL = this.results.reduce((sum, r) => sum + r.position.pnl!, 0);
      const avgWin = wins.length > 0 ? 
        wins.reduce((sum, r) => sum + r.position.pnl!, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? 
        Math.abs(losses.reduce((sum, r) => sum + r.position.pnl!, 0) / losses.length) : 0;
  
      const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0;
      const winRate = this.results.length > 0 ? 
        (wins.length / this.results.length) * 100 : 0;
  
      const avgRR = this.results.length > 0 ?
        this.results.reduce((sum, r) => sum + r.rr, 0) / this.results.length : 0;
  
      const returns = this.equityCurve.map((point, i) => {
        if (i === 0) return 0;
        const prev = this.equityCurve[i - 1].balance;
        return ((point.balance - prev) / prev) * 100;
      });
  
      const sharpeRatio = Helpers.sharpeRatio(returns);
      const balances = this.equityCurve.map(p => p.balance);
      const maxDD = Helpers.maxDrawdown(balances);
  
      return {
        totalTrades: this.results.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate,
        averageWin: avgWin,
        averageLoss: avgLoss,
        averageRR: avgRR,
        profitFactor,
        finalBalance: this.balance,
        totalPnL,
        totalPnLPercent: ((this.balance - config.initialBalance) / config.initialBalance) * 100,
        maxDrawdown: maxDD.amount,
        maxDrawdownPercent: maxDD.percent,
        sharpeRatio,
        trades: this.results,
        equityCurve: this.equityCurve
      };
    }
  
    private saveResults(result: BacktestResult): void {
      const resultsDir = './backtest-results';
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = path.join(resultsDir, `backtest-${timestamp}.json`);
      fs.writeFileSync(filename, JSON.stringify(result, null, 2));
      logger.info('Backtest', `Results saved to ${filename}`);
    }
  
    private displaySummary(result: BacktestResult): void {
      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║                 BACKTEST RESULTS                          ║');
      console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
      console.log(`📊 Total Trades: ${result.totalTrades}`);
      console.log(`   Wins: ${result.winningTrades} | Losses: ${result.losingTrades}`);
      console.log(`   Win Rate: ${result.winRate.toFixed(2)}%\n`);
  
      console.log(`💰 Performance (Net):`);
      console.log(`   Initial Balance: ${Helpers.formatCurrency(result.finalBalance - result.totalPnL)}`);
      console.log(`   Final Balance: ${Helpers.formatCurrency(result.finalBalance)}`);
      console.log(`   Total PnL (Net): ${Helpers.formatCurrency(result.totalPnL)} (${result.totalPnLPercent.toFixed(2)}%)`);
      console.log(`   Fees Paid: ${Helpers.formatCurrency(-this.totalFeesPaid)} (Included in PnL)\n`);
  
      console.log(`📈 Risk Metrics:`);
      console.log(`   Avg Win: ${Helpers.formatCurrency(result.averageWin)}`);
      console.log(`   Avg Loss: ${Helpers.formatCurrency(result.averageLoss)}`);
      console.log(`   Avg R:R: 1:${result.averageRR.toFixed(2)}`);
      console.log(`   Profit Factor: ${result.profitFactor.toFixed(2)}`);
      console.log(`   Max Drawdown: ${Helpers.formatCurrency(result.maxDrawdown)} (${result.maxDrawdownPercent.toFixed(2)}%)`);
      console.log(`   Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}\n`);
  
      const verdict = this.getVerdict(result);
      console.log(verdict);
      console.log('');
    }
  
    private getVerdict(result: BacktestResult): string {
      if (result.totalPnL > 0) {
        return `✅ PROFITABLE! The strategy is making real money after fees.`;
      } else {
        return '❌ UNPROFITABLE. Fees or losses are eating the capital.';
      }
    }
  }