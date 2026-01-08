/**
 * TradingBot - Application Layer
 * 
 * Clean Architecture version of TradingBot using Dependency Injection.
 * This bot receives IExchange through DI, decoupling it from Binance specifics.
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types';
import { IExchange } from '../domain/interfaces/IExchange';

@injectable()
export class TradingBot {
    private isRunning: boolean = false;

    constructor(
        @inject(TYPES.IExchange) private readonly exchange: IExchange
    ) {
        console.log('🤖 [TradingBot] Initialized with Clean Architecture DI');
    }

    /**
     * Start the trading bot
     * For Phase 1, this simply fetches candles to prove DI works
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            console.log('⚠️ [TradingBot] Bot is already running');
            return;
        }

        console.log('🚀 [TradingBot] Starting...');
        this.isRunning = true;

        try {
            // Proof of concept: Fetch candles using injected IExchange
            console.log('📊 [TradingBot] Fetching BTCUSDT candles via IExchange...');

            const candles = await this.exchange.getCandles('BTCUSDT', '5m', 10);

            if (candles.length === 0) {
                console.log('⚠️ [TradingBot] No candles received');
                return;
            }

            const lastCandle = candles[candles.length - 1];

            console.log('✅ [TradingBot] Successfully fetched candles!');
            console.log('📈 Last Candle:', {
                timestamp: new Date(lastCandle.timestamp).toISOString(),
                open: lastCandle.open,
                high: lastCandle.high,
                low: lastCandle.low,
                close: lastCandle.close,
                volume: lastCandle.volume,
                isBullish: lastCandle.isBullish,
                isBearish: lastCandle.isBearish,
                bodySize: lastCandle.bodySize.toFixed(2)
            });

            // Fetch current price
            const price = await this.exchange.getCurrentPrice('BTCUSDT');
            console.log(`💰 [TradingBot] Current BTCUSDT price: $${price}`);

            console.log('✅ [TradingBot] Phase 1 DI proof-of-concept complete!');

        } catch (error: any) {
            console.error('❌ [TradingBot] Error:', error.message);
            throw error;
        }
    }

    /**
     * Stop the trading bot
     */
    public async stop(): Promise<void> {
        console.log('🛑 [TradingBot] Stopping...');
        this.isRunning = false;
    }

    /**
     * Get bot status
     */
    public getInfo(): { status: string } {
        return {
            status: this.isRunning ? 'RUNNING' : 'STOPPED'
        };
    }
}
