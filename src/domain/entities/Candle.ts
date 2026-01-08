/**
 * Candle Domain Entity
 * 
 * Pure domain entity representing a price candle (OHLCV).
 * No external dependencies - part of the Domain Layer.
 */
export class Candle {
    constructor(
        public readonly timestamp: number,
        public readonly open: number,
        public readonly high: number,
        public readonly low: number,
        public readonly close: number,
        public readonly volume: number
    ) { }

    /**
     * Returns true if the candle is bullish (close > open)
     */
    get isBullish(): boolean {
        return this.close > this.open;
    }

    /**
     * Returns true if the candle is bearish (close < open)
     */
    get isBearish(): boolean {
        return this.close < this.open;
    }

    /**
     * Returns the body size of the candle (absolute difference between close and open)
     */
    get bodySize(): number {
        return Math.abs(this.close - this.open);
    }

    /**
     * Returns the full range of the candle (high - low)
     */
    get range(): number {
        return this.high - this.low;
    }

    /**
     * Returns the upper wick size
     */
    get upperWick(): number {
        return this.high - Math.max(this.open, this.close);
    }

    /**
     * Returns the lower wick size
     */
    get lowerWick(): number {
        return Math.min(this.open, this.close) - this.low;
    }

    /**
     * Returns true if the candle is a doji (very small body relative to range)
     * @param threshold - The threshold ratio for body/range (default: 0.1)
     */
    isDojiCandle(threshold: number = 0.1): boolean {
        if (this.range === 0) return true;
        return this.bodySize / this.range < threshold;
    }
}
