import { Candle } from '../entities/Candle';

/**
 * Bollinger Bands result
 */
export interface BollingerBandsResult {
    upper: number[];
    middle: number[];
    lower: number[];
}

/**
 * MACD result
 */
export interface MACDResult {
    macd: number[];
    signal: number[];
    histogram: number[];
}

/**
 * Pivot Points result
 */
export interface PivotPointsResult {
    highs: number[];
    lows: number[];
}

/**
 * Trend Structure result
 */
export interface TrendStructureResult {
    higherHighs: boolean;
    lowerLows: boolean;
    higherLows: boolean;
    lowerHighs: boolean;
}

/**
 * IIndicators Interface
 * 
 * Domain interface for technical indicator calculations.
 * All methods are pure functions - stateless, deterministic calculations.
 */
export interface IIndicators {
    // Moving Averages
    sma(data: number[], period: number): number[];
    ema(data: number[], period: number): number[];

    // Momentum Indicators
    rsi(prices: number[], period?: number): number[];
    macd(
        prices: number[],
        fastPeriod?: number,
        slowPeriod?: number,
        signalPeriod?: number
    ): MACDResult;

    // Volatility Indicators
    atr(candles: Candle[], period?: number): number[];
    bollingerBands(
        prices: number[],
        period?: number,
        stdDev?: number
    ): BollingerBandsResult;
    stdDev(values: number[]): number;

    // Volume Indicators
    volumeAverage(candles: Candle[], period?: number): number[];

    // Cross Detection
    crossOver(values1: number[], values2: number[]): boolean;
    crossUnder(values1: number[], values2: number[]): boolean;

    // Utility
    percentChange(oldValue: number, newValue: number): number;

    // Structure Analysis
    findPivots(
        candles: Candle[],
        leftBars?: number,
        rightBars?: number
    ): PivotPointsResult;
    detectTrendStructure(
        candles: Candle[],
        lookback?: number
    ): TrendStructureResult;
}
