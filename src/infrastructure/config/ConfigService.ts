/**
 * Configuration Service
 * 
 * Infrastructure service that loads and validates configuration from environment.
 * Uses Zod for runtime type-safety and validation.
 */

import { injectable } from 'inversify';
import * as dotenv from 'dotenv';
import {
    BotConfigSchema,
    StrategyConfigSchema,
    RiskConfigSchema,
    ExchangeConfigSchema,
    BotConfig,
    StrategyConfig,
    RiskConfig,
    ExchangeConfig,
} from './schema';

// Load .env file
dotenv.config();

@injectable()
export class ConfigService {
    private readonly config: BotConfig;

    constructor() {
        this.config = this.loadAndValidate();
        console.log('✅ [ConfigService] Configuration loaded and validated');
    }

    /**
     * Load configuration from environment and validate with Zod
     */
    private loadAndValidate(): BotConfig {
        try {
            const rawConfig = {
                exchange: {
                    apiKey: process.env.BINANCE_API_KEY || '',
                    apiSecret: process.env.BINANCE_API_SECRET || '',
                    testnet: process.env.BINANCE_USE_TESTNET === 'true',
                    baseUrl: process.env.BINANCE_API_URL,
                },
                symbols: this.parseSymbols(process.env.SYMBOLS),
                timeframe: process.env.TIMEFRAME || '5m',
                strategy: {
                    emaFast: this.parseNumber(process.env.EMA_FAST, 50),
                    emaSlow: this.parseNumber(process.env.EMA_SLOW, 200),
                    minTrendStrength: this.parseNumber(process.env.MIN_TREND_STRENGTH, 0.02),
                    rsiPeriod: this.parseNumber(process.env.RSI_PERIOD, 14),
                    rsiOverbought: this.parseNumber(process.env.RSI_OVERBOUGHT, 70),
                    rsiOversold: this.parseNumber(process.env.RSI_OVERSOLD, 30),
                    volumeSpikeMultiplier: this.parseNumber(process.env.VOLUME_SPIKE_MULTIPLIER, 1.5),
                    pullbackToEMA: process.env.PULLBACK_TO_EMA !== 'false',
                    maxPullbackDistance: this.parseNumber(process.env.MAX_PULLBACK_DISTANCE, 0.03),
                    cvdThreshold: this.parseNumber(process.env.CVD_THRESHOLD, 0.5),
                    oiChangeMin: this.parseNumber(process.env.OI_CHANGE_MIN, 0.1),
                    checkLiquidations: process.env.CHECK_LIQUIDATIONS !== 'false',
                    stopLossATRMultiplier: this.parseNumber(process.env.STOP_LOSS_ATR_MULTIPLIER, 1.5),
                    takeProfitRatio: this.parseNumber(process.env.TAKE_PROFIT_RATIO, 2.5),
                    trailingStop: process.env.TRAILING_STOP === 'true',
                    minVolume: this.parseNumber(process.env.MIN_VOLUME, 1000000),
                    maxSpread: this.parseNumber(process.env.MAX_SPREAD, 0.01),
                    btcSyncRequired: process.env.BTC_SYNC_REQUIRED === 'true',
                },
                risk: {
                    accountBalance: this.parseNumber(process.env.INITIAL_BALANCE, 1000),
                    riskPerTrade: this.parseNumber(process.env.RISK_PER_TRADE, 0.01),
                    maxOpenTrades: this.parseNumber(process.env.MAX_OPEN_TRADES, 2),
                    leverage: this.parseNumber(process.env.LEVERAGE, 2),
                    maxDailyLoss: this.parseNumber(process.env.MAX_DAILY_LOSS, 0.05),
                    maxDrawdown: this.parseNumber(process.env.MAX_DRAWDOWN, 0.15),
                    minRR: this.parseNumber(process.env.MIN_RR, 1.5),
                    maxGapEntryPercent: this.parseNumber(process.env.MAX_GAP_ENTRY_PERCENT, 0.003),
                },
            };

            // Validate with Zod
            const validated = BotConfigSchema.parse(rawConfig);

            // Additional custom validations
            if (validated.strategy.emaFast >= validated.strategy.emaSlow) {
                throw new Error('EMA Fast must be less than EMA Slow');
            }

            if (validated.strategy.rsiOverbought <= validated.strategy.rsiOversold) {
                throw new Error('RSI Overbought must be greater than RSI Oversold');
            }

            return validated;

        } catch (error: any) {
            console.error('❌ [ConfigService] Configuration validation failed:', error.message);
            throw error;
        }
    }

    /**
     * Parse symbols from comma-separated string or return default
     */
    private parseSymbols(value: string | undefined): string[] {
        if (!value) {
            return ['BTCUSDT', 'ETHUSDT'];
        }
        return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }

    /**
     * Parse number with fallback default
     */
    private parseNumber(value: string | undefined, defaultValue: number): number {
        if (!value) return defaultValue;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    // ============================================
    // PUBLIC GETTERS
    // ============================================

    /**
     * Get full configuration
     */
    getConfig(): BotConfig {
        return this.config;
    }

    /**
     * Get exchange configuration (API keys, testnet, etc.)
     */
    getExchangeConfig(): ExchangeConfig {
        return this.config.exchange;
    }

    /**
     * Get risk management configuration
     */
    getRiskConfig(): RiskConfig {
        return this.config.risk;
    }

    /**
     * Get strategy configuration
     */
    getStrategyConfig(): StrategyConfig {
        return this.config.strategy;
    }

    /**
     * Get trading symbols
     */
    getSymbols(): string[] {
        return this.config.symbols;
    }

    /**
     * Get trading timeframe
     */
    getTimeframe(): string {
        return this.config.timeframe;
    }

    /**
     * Check if running in testnet mode
     */
    isTestnet(): boolean {
        return this.config.exchange.testnet;
    }

    /**
     * Check if API keys are configured
     */
    hasApiKeys(): boolean {
        return this.config.exchange.apiKey.length > 0 &&
            this.config.exchange.apiSecret.length > 0;
    }
}

// ============================================
// SINGLETON EXPORT (Backward Compatibility)
// For files that don't use DI injection yet
// ============================================

let _instance: ConfigService | null = null;

export function getConfigService(): ConfigService {
    if (!_instance) {
        _instance = new ConfigService();
    }
    return _instance;
}

// Legacy-style singleton (matching ConfigManager usage)
export const config = getConfigService();

// Alias for backward compatibility with container.ts
export const ConfigManager = ConfigService;
