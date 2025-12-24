/**
 * Backtest Engine
 * Responsibility: Test strategy on historical data
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
  import * as fs from 'fs';
  import * as path from 'path';
  
  export class BacktestEngine {
    private binance: BinanceService;
    private results: TradeResult[] = [];
    private equityCurve: { timestamp: number; balance: number }[] = [];
    private balance: number;
  
    constructor() {
      this.binance = new BinanceService();
      this.balance = 0;
    }
  
    /**
     * Run backtest
     */
    public async run(backtestConfig: BacktestConfig): Promise<BacktestResult> {
      logger.info('Backtest', '🧪 Starting backtest...', {
        startDate: backtestConfig.startDate.toISOString(),
        endDate: backtestConfig.endDate.toISOString(),
        symbols: backtestConfig.symbols.join(', '),
        initialBalance: backtestConfig.initialBalance
      });
  
      this.balance = backtestConfig.initialBalance;
      this.results = [];
      this.equityCurve = [{ timestamp: backtestConfig.startDate.getTime(), balance: this.balance }];
  
      const riskManager = new RiskManager(backtestConfig.initialBalance);
      const strategyEngine = new StrategyEngine(riskManager);
  
      // For each symbol
      for (const symbol of backtestConfig.symbols) {
        logger.info('Backtest', `Testing ${symbol}...`);
  
        try {
          // Fetch historical data
          const candles = await this.fetchHistoricalData(
            symbol,
            backtestConfig.startDate,
            backtestConfig.endDate
          );
  
          if (candles.length < 200) {
            logger.warn('Backtest', `Insufficient data for ${symbol}`);
            continue;
          }
  
          // Simulate trading
          await this.simulateTrading(symbol, candles, strategyEngine, riskManager);
  
        } catch (error: any) {
          logger.error('Backtest', `Error testing ${symbol}`, error.message);
        }
      }
  
      // Calculate results
      const result = this.calculateResults(backtestConfig);
  
      // Save results
      this.saveResults(result);
  
      // Display summary
      this.displaySummary(result);
  
      return result;
    }
  
    /**
     * Fetch historical data
     */
    private async fetchHistoricalData(
        symbol: string,
        startDate: Date,
        endDate: Date
      ): Promise<Candle[]> {
        const allCandles: Candle[] = [];
        let currentTime = startDate.getTime();
        const endTime = endDate.getTime();
    
        // Добавим лог для отладки
        logger.info('Backtest', `Fetching data for ${symbol} from ${startDate.toISOString()}...`);
  
        while (currentTime < endTime) {
          // ИСПРАВЛЕНИЕ: Передаем currentTime как startTime
          const candles = await this.binance.getCandles(symbol, '5m', 1000, currentTime);
          
          if (candles.length === 0) break;
    
          // Filter candles in time range
          const filtered = candles.filter(c => 
            c.timestamp >= startDate.getTime() && 
            c.timestamp <= endDate.getTime()
          );
    
          allCandles.push(...filtered);
          
          // Лог прогресса, чтобы видеть, что данные идут
          if (allCandles.length % 5000 === 0) {
              process.stdout.write('.');
          }
  
          // Stop if we reached the end of available data (last candle is close to now)
          const lastCandleTime = candles[candles.length - 1].timestamp;
          if (lastCandleTime >= endTime || candles.length < 1000) {
              break;
          }
    
          // Move to next batch (last candle time + 5 mins)
          currentTime = lastCandleTime + 300000; 
    
          // Avoid rate limits
          await Helpers.sleep(200); 
        }
        
        console.log(''); // New line after dots
        logger.info('Backtest', `Loaded ${allCandles.length} candles for ${symbol}`);
    
        return allCandles.sort((a, b) => a.timestamp - b.timestamp);
    }
  
    /**
     * Simulate trading on historical data
     */
    private async simulateTrading(
      symbol: string,
      candles: Candle[],
      strategyEngine: StrategyEngine,
      riskManager: RiskManager
    ): Promise<void> {
      let openPosition: Position | null = null;
  
      // Walk forward through candles
      for (let i = 200; i < candles.length; i++) {
        const currentCandles = candles.slice(0, i + 1);
        const currentCandle = candles[i];
  
        // Check open position
        if (openPosition) {
          const result = this.checkPositionExit(openPosition, currentCandle);
          
          if (result) {
            // Position closed
            this.results.push(result);
            this.balance += result.position.pnl!;
            riskManager.updateBalance(result.position.pnl!);
            
            this.equityCurve.push({
              timestamp: currentCandle.timestamp,
              balance: this.balance
            });
  
            logger.debug('Backtest', `${symbol} ${result.won ? '✅ WIN' : '❌ LOSS'}`, {
              pnl: Helpers.formatCurrency(result.position.pnl!),
              balance: Helpers.formatCurrency(this.balance)
            });
  
            openPosition = null;
          }
          continue;
        }
  
        // Look for new signal
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
          // Open position
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
  
          logger.debug('Backtest', `${symbol} OPEN ${openPosition.side}`, {
            entry: openPosition.entry,
            size: Helpers.formatCurrency(openPosition.size)
          });
        }
      }
    }
  
    /**
     * Check if position should exit
     */
    private checkPositionExit(
      position: Position,
      currentCandle: Candle
    ): TradeResult | null {
      const isLong = position.side === PositionSide.LONG;
      const currentPrice = currentCandle.close;
  
      let exitReason: TradeExitReason | null = null;
      let exitPrice = currentPrice;
  
      // Check Stop Loss
      if (isLong && currentCandle.low <= position.stopLoss) {
        exitReason = TradeExitReason.STOP_LOSS;
        exitPrice = position.stopLoss;
      } else if (!isLong && currentCandle.high >= position.stopLoss) {
        exitReason = TradeExitReason.STOP_LOSS;
        exitPrice = position.stopLoss;
      }
  
      // Check Take Profit
      if (isLong && currentCandle.high >= position.takeProfit) {
        exitReason = TradeExitReason.TAKE_PROFIT;
        exitPrice = position.takeProfit;
      } else if (!isLong && currentCandle.low <= position.takeProfit) {
        exitReason = TradeExitReason.TAKE_PROFIT;
        exitPrice = position.takeProfit;
      }
  
      if (!exitReason) return null;
  
      // Calculate PnL
      const pnl = Helpers.calculatePnL(
        position.entry,
        exitPrice,
        position.size,
        isLong,
        position.leverage
      );
  
      // Update position
      position.closeTime = currentCandle.timestamp;
      position.closePrice = exitPrice;
      position.pnl = pnl.pnl;
      position.pnlPercent = pnl.pnlPercent;
      position.status = PositionStatus.CLOSED;
      position.exitReason = exitReason;
  
      const rr = Helpers.calculateRR(position.entry, position.stopLoss, exitPrice, isLong);
  
      return {
        position,
        won: pnl.pnl > 0,
        rr,
        holdTime: position.closeTime - position.openTime,
        slippage: 0
      };
    }
  
    /**
     * Calculate backtest results
     */
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
  
      // Calculate returns for Sharpe ratio
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
  
    /**
     * Save results to file
     */
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
  
    /**
     * Display summary
     */
    private displaySummary(result: BacktestResult): void {
      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║                 BACKTEST RESULTS                          ║');
      console.log('╚═══════════════════════════════════════════════════════════╝\n');
  
      console.log(`📊 Total Trades: ${result.totalTrades}`);
      console.log(`   Wins: ${result.winningTrades} | Losses: ${result.losingTrades}`);
      console.log(`   Win Rate: ${result.winRate.toFixed(2)}%\n`);
  
      console.log(`💰 Performance:`);
      console.log(`   Initial Balance: ${Helpers.formatCurrency(result.finalBalance - result.totalPnL)}`);
      console.log(`   Final Balance: ${Helpers.formatCurrency(result.finalBalance)}`);
      console.log(`   Total PnL: ${Helpers.formatCurrency(result.totalPnL)} (${result.totalPnLPercent.toFixed(2)}%)\n`);
  
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
  
    /**
     * Get verdict on backtest results
     */
    private getVerdict(result: BacktestResult): string {
      if (result.winRate >= 40 && result.averageRR >= 2 && result.totalPnLPercent > 0) {
        return '✅ EXCELLENT! Strategy meets target criteria (40-50% WR, R:R 1:2+)';
      } else if (result.winRate >= 35 && result.averageRR >= 1.5 && result.totalPnLPercent > 0) {
        return '⚠️  ACCEPTABLE. Close to target but needs optimization.';
      } else {
        return '❌ POOR. Strategy needs significant improvement.';
      }
    }
  }