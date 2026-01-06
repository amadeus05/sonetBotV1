/**
 * Configuration Manager
 * Single Responsibility: Load and validate configuration
 */

import * as dotenv from 'dotenv';
import { BotConfig, StrategyConfig, RiskParameters } from '../types';

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

  public updateConfig(updates: Partial<BotConfig>): void {
    this.config = { ...this.config, ...updates };
    this.validateConfig();
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
      riskPerTrade: parseFloat(process.env.RISK_PER_TRADE || '0.01'),
      maxOpenTrades: parseInt(process.env.MAX_OPEN_TRADES || '2'),
      leverage: parseInt(process.env.LEVERAGE || '2'),
      maxDailyLoss: 0.05,      // 5% max daily loss
      maxDrawdown: 0.15,       // 15% max drawdown
      minRR: parseFloat(process.env.MIN_RR || '1.5'),
    };

    return {
      apiKey: process.env.BINANCE_API_KEY || '',
      apiSecret: process.env.BINANCE_API_SECRET || '',
      testnet: process.env.BINANCE_USE_TESTNET === 'true',
      symbols: [
        // 'BTCUSDT',
        'BNBUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'ZECUSDT',
        'TAOUSDT',
        // 'XRPUSDT',
        // 'DOGEUSDT',
        // 'ADAUSDT',
        // 'TRXUSDT',
        // 'SUIUSDT',
        // 'NEARUSDT',
        // 'LINKUSDT',
        // 'DOTUSDT',
        // 'TONUSDT',
        // 'AVAXUSDT',
        // 'RENDERUSDT',
      ],
      timeframe: '5m',
      strategy,
      risk
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