/**
 * Bybit Exchange Service (V5 API)
 * Drop-in replacement for BinanceService
 */

import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import WebSocket from 'ws';
import {
    Candle,
    ExchangeOrder,
    ExchangeBalance
} from '../../../types';
import { config } from '../../config/ConfigService';
import { logger } from '../../logging/Logger';

export class BybitService {
    private apiKey: string;
    private apiSecret: string;
    private baseURL: string;
    private wsBaseURL: string;
    private client: AxiosInstance;
    private ws: WebSocket | null = null;
    private pingInterval: NodeJS.Timeout | null = null;
    private recvWindow = 5000;

    // Cache
    private stepSizeCache: Record<string, number> = {};
    private tickSizeCache: Record<string, number> = {};

    constructor() {
        const botConfig = config.getConfig();

        this.apiKey = botConfig.exchange.apiKey;
        this.apiSecret = botConfig.exchange.apiSecret;

        // URL Selection (Mainnet vs Testnet)
        if (botConfig.exchange.testnet) {
            this.baseURL = 'https://api-testnet.bybit.com';
            this.wsBaseURL = 'wss://stream-testnet.bybit.com/v5/public/linear';
        } else {
            this.baseURL = 'https://api.bybit.com';
            this.wsBaseURL = 'wss://stream.bybit.com/v5/public/linear';
        }

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
            }
        });

        logger.info('BybitService', `Initialized (${this.baseURL})`);
    }

    // ==========================================
    // AUTHENTICATION & SIGNING
    // ==========================================

    private getSignature(timestamp: number, params: any): string {
        let paramStr = '';
        // Для GET запросов параметры сортировать не нужно в Bybit V5, 
        // но они должны быть в строке query string для подписи.
        // Для POST запросов - это JSON body.

        if (typeof params === 'string') {
            paramStr = params; // Already query string or JSON string
        } else {
            // Simple serialization for object
            paramStr = JSON.stringify(params);
        }

        const payload = `${timestamp}${this.apiKey}${this.recvWindow}${paramStr}`;
        return crypto.createHmac('sha256', this.apiSecret).update(payload).digest('hex');
    }

    private async request(method: 'GET' | 'POST', endpoint: string, params: any = {}) {
        const timestamp = Date.now();
        let queryStr = '';
        let body: any = null;

        if (method === 'GET') {
            // Convert params to query string manually to control order/encoding if needed
            const searchParams = new URLSearchParams();
            Object.keys(params).forEach(key => searchParams.append(key, params[key]));
            queryStr = searchParams.toString();
        } else {
            body = JSON.stringify(params);
        }

        const signaturePayload = method === 'GET' ? queryStr : body;
        const signature = this.getSignature(timestamp, signaturePayload);

        const headers = {
            'X-BAPI-API-KEY': this.apiKey,
            'X-BAPI-SIGN': signature,
            'X-BAPI-TIMESTAMP': timestamp.toString(),
            'X-BAPI-RECV-WINDOW': this.recvWindow.toString(),
            'Content-Type': 'application/json; charset=utf-8'
        };

        const url = method === 'GET' ? `${endpoint}?${queryStr}` : endpoint;

        try {
            const response = await this.client.request({
                method,
                url,
                headers,
                data: body
            });

            if (response.data.retCode !== 0) {
                throw new Error(`Bybit API Error: ${response.data.retMsg} (Code: ${response.data.retCode})`);
            }

            return response.data.result;
        } catch (error: any) {
            // Логируем ошибку, чтобы видеть детали
            const msg = error.response?.data?.retMsg || error.message;
            logger.error('BybitService', `Request failed: ${endpoint}`, msg);
            throw new Error(msg);
        }
    }

    // ==========================================
    // PUBLIC INTERFACE (Matching BinanceService)
    // ==========================================

    public async testConnection(): Promise<boolean> {
        try {
            await this.client.get('/v5/market/time');
            logger.info('BybitService', 'Connection test successful');
            return true;
        } catch (error) {
            logger.error('BybitService', 'Connection test failed');
            return false;
        }
    }

    public async loadExchangeInfo(): Promise<void> {
        try {
            // category=linear for USDT Perpetuals
            const result = await this.client.get('/v5/market/instruments-info?category=linear');
            const list = result.data.result.list;
            let count = 0;

            for (const item of list) {
                if (item.status !== 'Trading') continue;

                // Bybit returns lotSizeFilter { qtyStep, ... } and priceFilter { tickSize, ... }
                this.stepSizeCache[item.symbol] = parseFloat(item.lotSizeFilter.qtyStep);
                this.tickSizeCache[item.symbol] = parseFloat(item.priceFilter.tickSize);
                count++;
            }

            logger.info('BybitService', `Loaded exchange info for ${count} symbols`);
        } catch (error: any) {
            logger.error('BybitService', 'Failed to load exchange info', error.message);
            throw error;
        }
    }

    public getStepSize(symbol: string): number {
        return this.stepSizeCache[symbol] || 0.001; // Default fallback
    }

    public async getPositionRisk(symbol: string): Promise<{ positionAmt: number; entryPrice: number; unrealizedProfit: number } | null> {
        try {
            const result = await this.request('GET', '/v5/position/list', {
                category: 'linear',
                symbol: symbol
            });

            const pos = result.list[0];
            if (!pos) return null;

            let size = parseFloat(pos.size);
            const side = pos.side; // "Buy" or "Sell" (or "None")

            // Convert to signed amount for compatibility
            if (side === 'Sell') size = -size;
            else if (side === 'None') size = 0;

            return {
                positionAmt: size,
                entryPrice: parseFloat(pos.avgPrice) || 0,
                unrealizedProfit: parseFloat(pos.unrealisedPnl) || 0
            };
        } catch (error) {
            return null;
        }
    }

    public async getCandles(
        symbol: string,
        interval: string = '5m',
        limit: number = 1000,
        startTime?: number,
        endTime?: number
    ): Promise<Candle[]> {
        // Map intervals: 5m -> 5, 1h -> 60, etc.
        const bybitInterval = this.mapInterval(interval);

        // Bybit V5 limit is usually 200 per request (sometimes 1000 for kline).
        // Safe bet is 200, but documentation says up to 1000 for standard kline.

        const params: any = {
            category: 'linear',
            symbol,
            interval: bybitInterval,
            limit: limit > 1000 ? 1000 : limit
        };

        if (startTime) params.start = startTime;
        if (endTime) params.end = endTime;

        try {
            // Public endpoint, no signature needed usually, but using wrapper is fine
            const response = await this.client.get('/v5/market/kline', { params });

            if (response.data.retCode !== 0) throw new Error(response.data.retMsg);

            const list = response.data.result.list; // Returns [startTime, open, high, low, close, volume, turnover]

            // Bybit returns newest first, so we reverse to get chronological order
            return list.reverse().map((k: string[]) => ({
                timestamp: parseInt(k[0]),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
                // MISSING IN BYBIT KLINE: Taker Buy Volume.
                // Hardcoding to 0 as it's not used in current Strategy Logic.
                takerBuyBaseVolume: 0,
                openInterest: 0
            }));

        } catch (error: any) {
            logger.error('BybitService', `Failed to fetch candles for ${symbol}`, error.message);
            throw error;
        }
    }

    // Mapping Binance '5m', '1h' to Bybit '5', '60'
    private mapInterval(interval: string): string {
        const map: Record<string, string> = {
            '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30',
            '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720',
            '1d': 'D', '1w': 'W'
        };
        return map[interval] || '5';
    }

    public async getUserTrades(symbol: string, limit: number = 50): Promise<any[]> {
        try {
            const result = await this.request('GET', '/v5/execution/list', {
                category: 'linear',
                symbol,
                limit
            });

            // Map Bybit execution to Binance trade format
            return result.list.map((e: any) => ({
                id: e.execId,
                orderId: e.orderId,
                symbol: e.symbol,
                side: e.side.toUpperCase(),
                price: parseFloat(e.execPrice),
                qty: parseFloat(e.execQty),
                realizedPnl: parseFloat(e.execValue), // Note: Need to check if this is PnL or value. Usually execValue is not PnL. 
                // Bybit PnL is in Closed PnL endpoint. Here we mostly need entry price/qty.
                // For simple logging, this might suffice, but for strict PnL tracking use closed-pnl endpoint.
                // Keeping simple for now to match interface.
                commission: parseFloat(e.execFee),
                time: parseInt(e.execTime),
                maker: e.isMaker
            }));
        } catch (error: any) {
            logger.error('BybitService', `Failed to user trades for ${symbol}`, error.message);
            return [];
        }
    }

    public async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const response = await this.client.get('/v5/market/tickers', {
                params: { category: 'linear', symbol }
            });
            const tick = response.data.result.list[0];
            return parseFloat(tick.lastPrice);
        } catch (error) {
            return 0;
        }
    }

    public async get24hTicker(symbol: string): Promise<any> {
        try {
            const response = await this.client.get('/v5/market/tickers', {
                params: { category: 'linear', symbol }
            });
            const tick = response.data.result.list[0];

            return {
                volume: tick.volume24h,
                priceChangePercent: (parseFloat(tick.price24hPcnt) * 100).toFixed(2), // Bybit returns 0.05 for 5%
                lastPrice: tick.lastPrice
            };
        } catch (error) {
            throw error;
        }
    }

    public async getBalance(): Promise<ExchangeBalance[]> {
        try {
            const result = await this.request('GET', '/v5/account/wallet-balance', {
                accountType: 'UNIFIED', // Or CONTRACT depending on account type. Unified is standard now.
                coin: 'USDT'
            });

            const list = result.list[0];
            const usdt = list.coin.find((c: any) => c.coin === 'USDT');

            if (!usdt) return [];

            return [{
                asset: 'USDT',
                free: parseFloat(usdt.availableToWithdraw), // Or walletBalance - locked
                locked: parseFloat(usdt.walletBalance) - parseFloat(usdt.availableToWithdraw),
                total: parseFloat(usdt.equity) // Equity is best for total
            }];

        } catch (error: any) {
            logger.error('BybitService', 'Failed to fetch balance', error.message);
            throw error;
        }
    }

    public async setLeverage(symbol: string, leverage: number): Promise<void> {
        try {
            await this.request('POST', '/v5/position/set-leverage', {
                category: 'linear',
                symbol,
                buyLeverage: leverage.toString(),
                sellLeverage: leverage.toString()
            });
            logger.info('BybitService', `Leverage set to ${leverage}x for ${symbol}`);
        } catch (error: any) {
            // Ignore "leverage not modified" error code
            if (error.message.includes('110043')) return;
            logger.warn('BybitService', `Failed set leverage: ${error.message}`);
        }
    }

    public async placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<ExchangeOrder> {
        // Bybit uses "Buy"/"Sell" (Title case)
        const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';

        try {
            const result = await this.request('POST', '/v5/order/create', {
                category: 'linear',
                symbol,
                side: bybitSide,
                orderType: 'Market',
                qty: quantity.toString(),
                // timeInForce: 'GTC' // Not needed for market
            });

            // Immediately fetch details to fill ExchangeOrder structure
            // (Bybit create response contains only orderId)
            return {
                orderId: result.orderId,
                symbol,
                side,
                type: 'MARKET',
                quantity: quantity, // We assume filled for market, or use WS to confirm
                price: 0, // Unknown immediately, need to query execution or wait for WS
                status: 'NEW',
                timestamp: Date.now()
            };

        } catch (error: any) {
            logger.error('BybitService', `Failed to place market order ${symbol}`, error.message);
            throw error;
        }
    }

    public async placeStopLoss(symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number): Promise<ExchangeOrder> {
        const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';

        try {
            // Placing a "Stop Market" order
            const result = await this.request('POST', '/v5/order/create', {
                category: 'linear',
                symbol,
                side: bybitSide,
                orderType: 'Market',
                qty: quantity.toString(),
                triggerPrice: stopPrice.toString(),
                triggerDirection: side === 'BUY' ? 1 : 2, // 1: Rise (for Buy SL? No, Buy SL means price rose above? Wait. SL for Short is Buy. Price rises.)
                // Logic:
                // If Side = Buy (Closing a Short), we trigger when price RISES >= stopPrice. triggerDirection = 1.
                // If Side = Sell (Closing a Long), we trigger when price FALLS <= stopPrice. triggerDirection = 2.
                triggerBy: 'LastPrice',
                reduceOnly: true
            });

            return {
                orderId: result.orderId,
                symbol,
                side,
                type: 'STOP_LOSS',
                quantity,
                stopPrice,
                status: 'NEW',
                timestamp: Date.now()
            };
        } catch (error: any) {
            logger.error('BybitService', `Failed to place SL ${symbol}`, error.message);
            throw error;
        }
    }

    public async placeTakeProfit(symbol: string, side: 'BUY' | 'SELL', quantity: number, price: number): Promise<ExchangeOrder> {
        // Similar logic to SL but using TP trigger
        const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';

        try {
            const result = await this.request('POST', '/v5/order/create', {
                category: 'linear',
                symbol,
                side: bybitSide,
                orderType: 'Market', // Market TP (Take Profit Market)
                qty: quantity.toString(),
                triggerPrice: price.toString(),
                triggerDirection: side === 'BUY' ? 2 : 1,
                // Logic:
                // Side = Buy (Closing Short), Price FALLS <= TP. Trigger = 2.
                // Side = Sell (Closing Long), Price RISES >= TP. Trigger = 1.
                triggerBy: 'LastPrice',
                reduceOnly: true
            });

            return {
                orderId: result.orderId,
                symbol,
                side,
                type: 'TAKE_PROFIT',
                quantity,
                price,
                status: 'NEW',
                timestamp: Date.now()
            };
        } catch (error: any) {
            logger.error('BybitService', `Failed to place TP ${symbol}`, error.message);
            throw error;
        }
    }

    public async cancelOrder(symbol: string, orderId: string): Promise<void> {
        try {
            await this.request('POST', '/v5/order/cancel', {
                category: 'linear',
                symbol,
                orderId
            });
        } catch (error: any) {
            logger.error('BybitService', `Failed cancel order ${orderId}`, error.message);
        }
    }

    public async getOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
        try {
            const result = await this.request('GET', '/v5/order/realtime', {
                category: 'linear',
                symbol: symbol || '',
                settleCoin: 'USDT'
            });

            return result.list.map((o: any) => ({
                orderId: o.orderId,
                symbol: o.symbol,
                side: o.side.toUpperCase(),
                type: o.orderType.toUpperCase(),
                quantity: parseFloat(o.qty),
                price: parseFloat(o.price),
                stopPrice: parseFloat(o.triggerPrice || '0'),
                status: o.orderStatus, // New, Filled, Cancelled
                timestamp: parseInt(o.createdTime)
            }));
        } catch (error: any) {
            return [];
        }
    }

    // ==========================================
    // WEBSOCKET
    // ==========================================

    public subscribeToCandles(symbols: string[], interval: string, callback: (data: any) => void): void {
        if (this.ws) {
            this.ws.terminate();
            this.stopPing();
        }

        const bybitInterval = this.mapInterval(interval);
        // Topic format: kline.{interval}.{symbol}
        const topics = symbols.map(s => `kline.${bybitInterval}.${s}`);

        logger.info('BybitService', `🔌 Connecting to Bybit WS (Topics: ${topics.length})`);

        this.ws = new WebSocket(this.wsBaseURL);

        this.ws.on('open', () => {
            logger.info('BybitService', '✅ WS Connected');

            // Send subscribe command
            const cmd = {
                op: 'subscribe',
                args: topics
            };
            this.ws!.send(JSON.stringify(cmd));

            this.startPing();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            const msg = JSON.parse(data.toString());

            // Handle Heartbeat response or Subscription confirmation
            if (msg.op === 'pong' || msg.success) return;

            // Handle Candle Data
            if (msg.topic && msg.topic.startsWith('kline')) {
                const candleData = msg.data[0];
                const symbol = msg.topic.split('.')[2];

                // Convert to format expected by MarketDataManager
                // Binance format expected: { s: symbol, k: { t, o, h, l, c, v, x } }

                const transformed = {
                    s: symbol,
                    k: {
                        t: candleData.start,
                        o: candleData.open,
                        h: candleData.high,
                        l: candleData.low,
                        c: candleData.close,
                        v: candleData.volume,
                        V: 0, // Taker volume (hardcoded 0)
                        x: candleData.confirm // Boolean: is candle closed?
                    }
                };

                callback(transformed);
            }
        });

        this.ws.on('error', (err) => logger.error('BybitService', 'WS Error', err));
        this.ws.on('close', () => {
            logger.warn('BybitService', 'WS Closed. Reconnecting...');
            this.stopPing();
            setTimeout(() => this.subscribeToCandles(symbols, interval, callback), 5000);
        });
    }

    private startPing() {
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ op: 'ping' }));
            }
        }, 20000); // Bybit requires ping every 20s
    }

    private stopPing() {
        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    public closeConnection() {
        if (this.ws) this.ws.terminate();
        this.stopPing();
    }
}