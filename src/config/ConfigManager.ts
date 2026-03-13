/**
 * Configuration Manager
 * Single Responsibility: Load and validate configuration
 */

import * as dotenv from 'dotenv';
import { BotConfig, StrategyConfig, RiskParameters, FeeConfig, TelegramConfig } from '../types';

dotenv.config();

export class ConfigManager {
  private static instance: ConfigManager;
  private config: BotConfig;

  private constructor() {
    this.config = this.loadConfig();
    this.validateConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public getConfig(): BotConfig {
    return this.config;
  }

  public getStrategyConfig(): StrategyConfig {
    return this.config.strategy;
  }

  public getRiskConfig(): RiskParameters {
    return this.config.risk;
  }

  public getTelegramConfig(): TelegramConfig {
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      enabled: process.env.TELEGRAM_ENABLED !== 'false'
    };
  }

  public getBacktestDateRange(): { startDate: Date; endDate: Date } {
    const now = new Date();
    const startDate = this.parseDateEnv(
      process.env.BACKTEST_START_DATE,
      'BACKTEST_START_DATE',
      new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)
    );
    const endDate = this.parseDateEnv(
      process.env.BACKTEST_END_DATE,
      'BACKTEST_END_DATE',
      now
    );

    if (startDate.getTime() >= endDate.getTime()) {
      throw new Error('BACKTEST_START_DATE must be earlier than BACKTEST_END_DATE');
    }

    return { startDate, endDate };
  }

  public updateConfig(updates: Partial<BotConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
  }

  private parseDateEnv(value: string | undefined, envName: string, fallback: Date): Date {
    if (!value || value.trim() === '') {
      return fallback;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${envName} must be a valid date string`);
    }

    return parsed;
  }

  private loadConfig(): BotConfig {
    const strategy: StrategyConfig = {
      emaFast: parseInt(process.env.EMA_FAST || '50'),
      emaSlow: parseInt(process.env.EMA_SLOW || '200'),
      minTrendStrength: parseFloat(process.env.MIN_TREND_STRENGTH || '0.02'),
      rsiPeriod: parseInt(process.env.RSI_PERIOD || '14'),
      rsiOverbought: parseInt(process.env.RSI_OVERBOUGHT || '70'),
      rsiOversold: parseInt(process.env.RSI_OVERSOLD || '30'),
      volumeSpikeMultiplier: parseFloat(process.env.VOLUME_SPIKE_MULTIPLIER || '1.5'),
      pullbackToEMA: true,
      maxPullbackDistance: parseFloat(process.env.MAX_PULLBACK_DISTANCE || '0.03'),
      cvdThreshold: parseFloat(process.env.CVD_THRESHOLD || '0.5'),
      oiChangeMin: parseFloat(process.env.OI_CHANGE_MIN || '0.1'),
      checkLiquidations: true,
      stopLossATRMultiplier: parseFloat(process.env.STOP_LOSS_ATR_MULTIPLIER || '1.5'),
      takeProfitRatio: parseFloat(process.env.TAKE_PROFIT_RATIO || '2.5'),
      trailingStop: false,
      minVolume: 1000000,
      maxSpread: 0.01,
      btcSyncRequired: process.env.BTC_SYNC_REQUIRED === 'true'
    };

    const risk: RiskParameters = {
      accountBalance: parseFloat(process.env.INITIAL_BALANCE || '1000'),
      // По ТЗ: 0.5% риска на сделку
      riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.005'),
      maxOpenTrades: parseInt(process.env.MAX_OPEN_TRADES || '2'),
      leverage: parseInt(process.env.LEVERAGE || '2'),
      maxDailyLoss: 0.05,      // 5% max daily loss
      // По ТЗ: контроль DD ≤ 10%
      maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN || '0.10'),
      // По ТЗ: TP не ниже 1.2R (стратегия использует 1.4)
      minRR: parseFloat(process.env.MIN_RR || '1.2'),
    };

    const fees: FeeConfig = {
      maker: parseFloat(process.env.BINANCE_MAKER_FEE || '0.0002'),
      taker: parseFloat(process.env.BINANCE_TAKER_FEE || '0.0005'),
    };

    return {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      testnet: process.env.BINANCE_USE_TESTNET === 'true',
      symbols: [
        'BTCUSDT',
        'BNBUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'ZECUSDT',
        'TAOUSDT',
        'SUIUSDT',
        'ATOMUSDT',
        'ADAUSDT',
        'SOLUSDT',
        // 'LINKUSDT',
        // 'RENDERUSDT',
        // 'XRPUSDT',
        // 'DOGEUSDT',
        // 'ADAUSDT',
        // 'TRXUSDT',
        'NEARUSDT',
        'DOTUSDT',
        'AVAXUSDT',
      ],
      timeframe: '15m',
      strategy,
      risk,
      fees
    };
  }

  private validateConfig(): void {
    const { strategy, risk } = this.config;

    // Validate strategy parameters
    if (strategy.emaFast >= strategy.emaSlow) {
      throw new Error('EMA Fast must be less than EMA Slow');
    }

    if (strategy.rsiOverbought <= strategy.rsiOversold) {
      throw new Error('RSI Overbought must be greater than RSI Oversold');
    }

    if (strategy.takeProfitRatio < 1) {
      throw new Error('Take Profit Ratio must be at least 1:1');
    }

    // Validate risk parameters
    if (risk.riskPerTrade <= 0 || risk.riskPerTrade > 0.05) {
      throw new Error('Risk per trade must be between 0 and 5%');
    }

    if (risk.leverage < 1 || risk.leverage > 10) {
      throw new Error('Leverage must be between 1x and 10x');
    }

    if (risk.maxOpenTrades < 1 || risk.maxOpenTrades > 10) {
      throw new Error('Max open trades must be between 1 and 10');
    }
  }

  public toJSON(): string {
    return JSON.stringify(this.config, null, 2);
  }
}

// Export singleton instance
export const config = ConfigManager.getInstance();
