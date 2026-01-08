import { Candle } from '../entities/Candle';

/**
 * IExchange Interface
 * 
 * Domain interface defining the contract for exchange adapters.
 * All exchange implementations (Binance, Bybit, etc.) must implement this interface.
 * 
 * Key principle: This interface returns domain entities (Candle), not raw API data.
 * The mapping from raw exchange data to domain entities happens in the Infrastructure layer.
 */
export interface IExchange {
    /**
     * Fetches historical candles for a given symbol and timeframe.
     * 
     * @param symbol - Trading pair symbol (e.g., 'BTCUSDT')
     * @param timeframe - Candle timeframe (e.g., '1m', '5m', '1h', '1d')
     * @param limit - Optional number of candles to fetch (default depends on implementation)
     * @returns Promise resolving to an array of Candle domain entities
     */
    getCandles(symbol: string, timeframe: string, limit?: number): Promise<Candle[]>;

    /**
     * Gets the current market price for a given symbol.
     * 
     * @param symbol - Trading pair symbol (e.g., 'BTCUSDT')
     * @returns Promise resolving to the current price as a number
     */
    getCurrentPrice(symbol: string): Promise<number>;
}
