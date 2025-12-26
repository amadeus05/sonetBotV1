/**
 * Trading Bot Controller
 * Responsibility: Main orchestrator - runs the bot loop
 */

import { StrategyEngine } from './StrategyEngine';
import { TradeExecutor } from './TradeExecutor';
import { RiskManager } from './RiskManager';
import { BinanceService } from '../services/BinanceService';
import { config } from '../config/ConfigManager';
import { logger } from '../services/Logger';
import { db } from '../services/DatabaseManager';
import { Helpers } from '../utils/Helpers';

export class TradingBot {
  private binance: BinanceService;
  private riskManager: RiskManager;
  private strategyEngine: StrategyEngine;
  private tradeExecutor: TradeExecutor;
  private isRunning: boolean = false;
  private intervalId?: NodeJS.Timeout;

  constructor() {
    const initialBalance = config.getRiskConfig().accountBalance;
    
    this.binance = new BinanceService();
    this.riskManager = new RiskManager(initialBalance);
    this.strategyEngine = new StrategyEngine(this.riskManager);
    this.tradeExecutor = new TradeExecutor(this.binance, this.riskManager);

    logger.info('TradingBot', '🤖 Bot initialized successfully');
  }

  /**
   * Start the trading bot
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('TradingBot', 'Bot is already running');
      return;
    }

    logger.info('TradingBot', '🚀 Starting trading bot...');

    // 1. Test connection
    const connected = await this.binance.testConnection();
    if (!connected) {
      throw new Error('Failed to connect to Binance');
    }

    // 2. Load Exchange Info (CRITICAL: Load LOT_SIZE filters)
    logger.info('TradingBot', '📥 Loading exchange rules...');
    await this.binance.loadExchangeInfo();

    // 3. Sync balance
    await this.syncBalance();

    // Start main loop
    this.isRunning = true;
    await this.mainLoop();

    // Set interval for continuous operation (every 1 minute)
    this.intervalId = setInterval(() => {
      this.mainLoop().catch(error => {
        logger.error('TradingBot', 'Error in main loop', error.message);
      });
    }, 60000); // 1 minute

    logger.info('TradingBot', '✅ Bot started successfully');
  }

  /**
   * Stop the trading bot
   */
  public async stop(): Promise<void> {
    logger.info('TradingBot', '🛑 Stopping trading bot...');

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    logger.info('TradingBot', '✅ Bot stopped');
  }

  /**
   * Main trading loop
   */
  private async mainLoop(): Promise<void> {
    try {
      // Check for emergency stop conditions
      if (this.riskManager.shouldEmergencyStop()) {
        await this.tradeExecutor.emergencyCloseAll();
        await this.stop();
        return;
      }

      // Monitor existing positions
      await this.tradeExecutor.monitorPositions();

      // Check if we can look for new trades
      if (!this.riskManager.canOpenPosition()) {
        logger.debug('TradingBot', 'Cannot open new positions - skipping analysis');
        return;
      }

      // Analyze all symbols
      const symbols = config.getConfig().symbols;
      
      for (const symbol of symbols) {
        try {
          await this.analyzeSymbol(symbol);
        } catch (error: any) {
          logger.error('TradingBot', `Error analyzing ${symbol}`, error.message);
        }
      }

      // Log status
      this.logStatus();

    } catch (error: any) {
      logger.error('TradingBot', 'Error in main loop', error.message);
    }
  }

  /**
   * Analyze a single symbol
   */
  private async analyzeSymbol(symbol: string): Promise<void> {
    logger.debug('TradingBot', `Analyzing ${symbol}...`);

    // Fetch market data
    const marketData = await this.binance.getMarketData(symbol);

    // Run strategy analysis
    const signal = await this.strategyEngine.analyze(marketData);

    if (!signal) {
      return; // No signal generated
    }

    // Execute the signal
    const position = await this.tradeExecutor.executeSignal(signal);

    if (position) {
      logger.info('TradingBot', `✅ Trade executed for ${symbol}`);
    }
  }

  /**
   * Sync balance from exchange
   */
  private async syncBalance(): Promise<void> {
    try {
      const balances = await this.binance.getBalance();
      const usdtBalance = balances.find(b => b.asset === 'USDT');

      if (usdtBalance && usdtBalance.total > 0) {
        logger.info('TradingBot', '💰 Balance synced from exchange', {
          balance: Helpers.formatCurrency(usdtBalance.total)
        });
        
        // Update risk manager balance if different
        const currentBalance = this.riskManager.getBalance();
        if (Math.abs(currentBalance - usdtBalance.total) > 1) {
          // Significant difference, sync it
          const diff = usdtBalance.total - currentBalance;
          this.riskManager.updateBalance(diff);
        }
      }
    } catch (error: any) {
      logger.warn('TradingBot', 'Could not sync balance from exchange', error.message);
    }
  }

  /**
   * Log bot status
   */
  private logStatus(): void {
    const stats = db.getPerformanceStats(7); // Last 7 days
    
    logger.info('TradingBot', '📊 Status Update', {
      balance: Helpers.formatCurrency(this.riskManager.getBalance()),
      dailyPnL: Helpers.formatCurrency(this.riskManager.getDailyPnL()),
      drawdown: Helpers.formatPercent(this.riskManager.getCurrentDrawdown()),
      trades7d: stats.totalTrades,
      winRate7d: Helpers.formatPercent(stats.winRate)
    });
  }

  /**
   * Get performance summary
   */
  public getPerformanceSummary(days: number = 30): any {
    const stats = db.getPerformanceStats(days);
    const currentBalance = this.riskManager.getBalance();
    const initialBalance = config.getRiskConfig().accountBalance;
    const totalReturn = ((currentBalance - initialBalance) / initialBalance) * 100;

    return {
      period: `Last ${days} days`,
      currentBalance,
      initialBalance,
      totalReturn,
      totalPnL: currentBalance - initialBalance,
      totalTrades: stats.totalTrades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      avgWin: stats.avgWin,
      avgLoss: stats.avgLoss,
      profitFactor: stats.avgLoss > 0 ? stats.avgWin / stats.avgLoss : 0,
      drawdown: this.riskManager.getCurrentDrawdown()
    };
  }

  /**
   * Get bot info
   */
  public getInfo(): any {
    const botConfig = config.getConfig();
    
    return {
      version: '1.0.0',
      mode: botConfig.testnet ? 'TESTNET' : 'PRODUCTION',
      status: this.isRunning ? 'RUNNING' : 'STOPPED',
      symbols: botConfig.symbols,
      timeframe: botConfig.timeframe,
      leverage: botConfig.risk.leverage,
      riskPerTrade: `${botConfig.risk.riskPerTrade * 100}%`,
      balance: this.riskManager.getBalance()
    };
  }

  /**
   * Force close all positions (emergency)
   */
  public async emergencyStop(): Promise<void> {
    logger.error('TradingBot', '🚨 EMERGENCY STOP INITIATED');
    await this.tradeExecutor.emergencyCloseAll();
    await this.stop();
  }
}