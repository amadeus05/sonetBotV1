/**
 * Trading Bot Controller (WebSocket / Event-Driven Version)
 * Responsibility: Main orchestrator - runs the bot based on market events
 */

import { StrategyEngine } from './StrategyEngine';
import { TradeExecutor } from './TradeExecutor';
import { RiskManager } from './RiskManager';
import { BinanceService } from '../services/BinanceService';
import { ExchangeContract } from '../services/contracts/ExchangeContract';
import { MarketDataManager } from '../services/MarketDataManager'; // Новый сервис
import { config } from '../config/ConfigManager';
import { logger } from '../services/Logger';
import { db } from '../services/DatabaseManager';
import { Helpers } from '../utils/Helpers';
import { MarketData } from '../types';

export class TradingBot {
  private exchange: ExchangeContract;
  private riskManager: RiskManager;
  private strategyEngine: StrategyEngine;
  private tradeExecutor: TradeExecutor;
  private marketDataManager: MarketDataManager;

  private isRunning: boolean = false;
  private positionMonitorInterval?: NodeJS.Timeout;

  constructor(exchange?: ExchangeContract) {
    const initialBalance = config.getRiskConfig().accountBalance;
    
    this.exchange = exchange ?? new BinanceService();
    this.riskManager = new RiskManager(initialBalance);
    this.strategyEngine = new StrategyEngine(this.riskManager);
    this.tradeExecutor = new TradeExecutor(this.exchange, this.riskManager);
    
    // Инициализируем менеджер рыночных данных
    this.marketDataManager = new MarketDataManager(this.exchange);

    logger.info('TradingBot', '🤖 Bot initialized successfully (Event-Driven Mode)');
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

    try {
      // 1. Test connection
      const connected = await this.exchange.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to Binance');
      }

      // 2. Load Exchange Info (CRITICAL: Load LOT_SIZE filters)
      logger.info('TradingBot', '📥 Loading exchange rules...');
      await this.exchange.loadExchangeInfo();

      // 3. Sync balance
      await this.syncBalance();

      // 4. Initialize WebSocket Data Stream
      // Бот скачивает историю и подписывается на сокет
      const symbols = config.getConfig().symbols;
      const timeframe = config.getConfig().timeframe;

      logger.info('TradingBot', `🔌 Connecting to WebSocket stream for ${timeframe}...`);
      
      await this.marketDataManager.initialize(symbols, timeframe, (symbol) => {
        // CALLBACK: Вызывается мгновенно при закрытии свечи
        this.onCandleClosed(symbol).catch(err => {
            logger.error('TradingBot', `Error in candle handler for ${symbol}`, err);
        });
      });

      this.isRunning = true;

      // 5. Start Independent Position Monitor
      // Проверяем открытые позиции (PnL, SL/TP) каждые 5 секунд
      // Это нужно, чтобы БД синхронизировалась с биржей, если сработает стоп
      this.positionMonitorInterval = setInterval(() => {
        this.tradeExecutor.monitorPositions().catch(error => {
          logger.error('TradingBot', 'Error in position monitor', error.message);
        });
      }, 5000);

      logger.info('TradingBot', '✅ Bot started successfully. Waiting for signals...');
      this.logStatus();

    } catch (error: any) {
      logger.error('TradingBot', 'Failed to start bot', error.message);
      process.exit(1);
    }
  }

  /**
   * Stop the trading bot
   */
  public async stop(): Promise<void> {
    logger.info('TradingBot', '🛑 Stopping trading bot...');

    this.isRunning = false;

    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
    }

    // Если у MarketDataManager есть метод для закрытия сокета, вызываем его
    // this.marketDataManager.close();

    logger.info('TradingBot', '✅ Bot stopped');
  }

  /**
   * Main Logic: Triggered when a candle closes via WebSocket
   * Replaces the old 'analyzeSymbol' and 'mainLoop'
   */
  private async onCandleClosed(symbol: string): Promise<void> {
    if (!this.isRunning) return;

    try {
      // 1. Fail-fast checks (Performance optimization)
      if (!this.riskManager.canOpenPosition()) {
        // Если лимиты риска исчерпаны, не тратим ресурсы на анализ
        return;
      }

      logger.debug('TradingBot', `🕯️ Candle closed for ${symbol}, analyzing...`);

      // 2. Get Data from RAM (Instant)
      const candles = this.marketDataManager.getCandles(symbol);
      const currentPrice = this.marketDataManager.getLastPrice(symbol);

      if (candles.length < 50) {
        logger.warn('TradingBot', `Not enough history for ${symbol} yet`);
        return;
      }

      // 4. Construct Market Data Object
      const marketData: MarketData = {
        symbol,
        candles, // Данные из памяти
        lastPrice: currentPrice, // Цена из памяти
      };

      // 5. Run Strategy Analysis
      const signal = await this.strategyEngine.analyze(marketData);

      if (!signal) {
        return; // No signal generated
      }

      // 6. Execute the signal
      const position = await this.tradeExecutor.executeSignal(signal);

      if (position) {
        logger.info('TradingBot', `✅ Trade executed for ${symbol} @ ${currentPrice}`);
        this.logStatus();
      }

    } catch (error: any) {
      logger.error('TradingBot', `Error analyzing ${symbol}`, error.message);
    }
  }

  /**
   * Sync balance from exchange
   */
  private async syncBalance(): Promise<void> {
    try {
      const balances = await this.exchange.getBalance();
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
      winRate7d: Helpers.formatPercent(stats.winRate),
      activePositions: db.getOpenPositions().length
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
      version: '1.1.0 (WebSocket)',
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
