import { injectable } from 'inversify';
import axios, { AxiosInstance } from 'axios';
import { IExchange } from '../../../domain/interfaces/IExchange';
import { Candle } from '../../../domain/entities/Candle';
import { BinanceMapper } from './BinanceMapper';

/**
 * BinanceAdapter
 * 
 * Infrastructure adapter implementing IExchange for Binance Futures.
 * Uses InversifyJS for dependency injection.
 * 
 * This adapter is responsible for:
 * - Making HTTP calls to Binance Futures API
 * - Mapping raw responses to domain entities via BinanceMapper
 * 
 * Note: This is a clean adapter implementing only IExchange methods.
 * For additional Binance functionality (orders, positions, etc.),
 * extend this class or create separate adapters.
 */
@injectable()
export class BinanceAdapter implements IExchange {
    private readonly client: AxiosInstance;
    private readonly baseURL: string;

    constructor() {
        // Read from environment or use default Binance Futures production endpoint
        this.baseURL = process.env.BINANCE_API_URL || 'https://fapi.binance.com';

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 10000,
        });
    }

    /**
     * Fetches historical candles for a given symbol and timeframe.
     * Maps raw Binance klines to Candle domain entities.
     * 
     * @param symbol - Trading pair symbol (e.g., 'BTCUSDT')
     * @param timeframe - Candle timeframe (e.g., '1m', '5m', '1h')
     * @param limit - Number of candles to fetch (default: 500, max: 1500)
     */
    async getCandles(symbol: string, timeframe: string, limit: number = 500): Promise<Candle[]> {
        const response = await this.client.get('/fapi/v1/klines', {
            params: {
                symbol,
                interval: timeframe,
                limit: Math.min(limit, 1500), // Binance max is 1500
            },
        });

        return BinanceMapper.toDomainArray(response.data);
    }

    /**
     * Gets the current market price for a given symbol.
     * 
     * @param symbol - Trading pair symbol (e.g., 'BTCUSDT')
     * @returns Current price as a number
     */
    async getCurrentPrice(symbol: string): Promise<number> {
        const response = await this.client.get('/fapi/v1/ticker/price', {
            params: { symbol },
        });

        return parseFloat(response.data.price);
    }
}
