/**
 * IStrategy Interface
 * 
 * Core domain interface for trading strategies.
 * Strategies analyze market data and generate trading signals.
 */

import { MarketData, TradingSignal } from '../../types';

/**
 * IStrategy - Domain Strategy Interface
 * 
 * Any trading strategy implementation must provide:
 * - analyze(): Analyzes market data and returns a trading signal if conditions are met
 */
export interface IStrategy {
    /**
     * Analyze market data and generate a trading signal if conditions are met.
     * 
     * @param marketData - Current market data including candles and price
     * @returns Trading signal if conditions are met, null otherwise
     */
    analyze(marketData: MarketData): Promise<TradingSignal | null>;
}
