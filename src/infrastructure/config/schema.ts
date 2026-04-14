/**
 * Configuration Schema
 * 
 * Zod schemas for runtime validation of configuration.
 * This replaces manual process.env parsing with type-safe validation.
 */

import { z } from 'zod';

// ============================================
// STRATEGY CONFIG SCHEMA
// ============================================

export const StrategyConfigSchema = z.object({
    // Trend Filter
    emaFast: z.number().int().positive().default(50),
    emaSlow: z.number().int().positive().default(200),
    minTrendStrength: z.number().min(0).max(1).default(0.02),

    // Momentum
    rsiPeriod: z.number().int().positive().default(14),
    rsiOverbought: z.number().int().min(50).max(100).default(70),
    rsiOversold: z.number().int().min(0).max(50).default(30),
    volumeSpikeMultiplier: z.number().positive().default(1.5),

    // Pullback
    pullbackToEMA: z.boolean().default(true),
    maxPullbackDistance: z.number().min(0).max(1).default(0.03),

    // Order Flow
    cvdThreshold: z.number().default(0.5),
    oiChangeMin: z.number().default(0.1),
    checkLiquidations: z.boolean().default(true),

    // Entry/Exit
    stopLossATRMultiplier: z.number().positive().default(1.5),
    takeProfitRatio: z.number().min(1).default(2.5),
    trailingStop: z.boolean().default(false),

    // Filters
    minVolume: z.number().nonnegative().default(1000000),
    maxSpread: z.number().min(0).max(1).default(0.01),
    btcSyncRequired: z.boolean().default(false),
});

// ============================================
// RISK CONFIG SCHEMA
// ============================================

export const RiskConfigSchema = z.object({
    accountBalance: z.number().positive().default(1000),
    riskPerTrade: z.number().min(0.001).max(0.05).default(0.01),
    maxOpenTrades: z.number().int().min(1).max(10).default(2),
    leverage: z.number().int().min(1).max(125).default(2),
    maxDailyLoss: z.number().min(0).max(1).default(0.05),
    maxDrawdown: z.number().min(0).max(1).default(0.15),
    minRR: z.number().min(1).default(1.5),
    /** Макс. допустимое ухудшение входа относительно цены сигнала (доля, 0.003 = 0.3%). Выше — сделка не открывается (бэктест) / сразу сбрасывается (лайв). */
    maxGapEntryPercent: z.number().min(0).max(0.1).default(0.003),
});

// ============================================
// EXCHANGE CONFIG SCHEMA
// ============================================

export const ExchangeConfigSchema = z.object({
    apiKey: z.string().default(''),
    apiSecret: z.string().default(''),
    testnet: z.boolean().default(false),
    baseUrl: z.string().url().optional(),
});

// ============================================
// MAIN BOT CONFIG SCHEMA
// ============================================

export const BotConfigSchema = z.object({
    exchange: ExchangeConfigSchema,
    symbols: z.array(z.string()).min(1).default(['BTCUSDT']),
    timeframe: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']).default('5m'),
    strategy: StrategyConfigSchema,
    risk: RiskConfigSchema,
});

// ============================================
// INFERRED TYPES (for TypeScript)
// ============================================

export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;
export type RiskConfig = z.infer<typeof RiskConfigSchema>;
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;
export type BotConfig = z.infer<typeof BotConfigSchema>;
