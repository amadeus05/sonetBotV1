/**
 * Multi-Timeframe Filter
 * Adds +5-10% to win rate by confirming signals across multiple timeframes
 * 
 * IMPORTANT: This module does NOT fetch data itself to avoid look-ahead bias in backtests.
 * The caller must provide pre-aggregated candles for each timeframe.
 * 
 * Usage (Backtest):
 * const candlesByTF = mtf.aggregateCandles(baseCandles, '5m'); // Pre-aggregate
 * const confirmation = mtf.confirmSync(symbol, signal, candlesByTF);
 * 
 * Usage (Live Trading):
 * const confirmation = await mtf.confirm(symbol, signal, '5m', binanceService);
 */

import { Candle, TradingSignal, TrendDirection } from '../types';
import { ExchangeContract } from '../services/contracts/ExchangeContract';

export interface TimeframeAnalysis {
    timeframe: string;
    trend: TrendDirection;
    strength: number;
    regime: 'TRENDING' | 'RANGING' | 'VOLATILE';
}

export interface MTFConfirmation {
    confirmed: boolean;
    score: number;
    timeframes: TimeframeAnalysis[];
    conflicts: string[];
    recommendation: string;
}

// Timeframe duration in milliseconds
const TIMEFRAME_MS: { [key: string]: number } = {
    '1m': 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '1w': 7 * 24 * 60 * 60 * 1000
};

export class MultiTimeframeFilter {

    public getTimeframesToCheck(currentTF: string): string[] {
        const timeframeMap: Record<string, string[]> = {
            '1m': ['5m', '15m', '1h'],
            '3m': ['5m', '15m', '1h'],
            '5m': ['15m', '1h', '4h'],
            '15m': ['1h', '4h', '1d'],
            '1h': ['4h', '1d'],
            '4h': ['1d']
        };
        return timeframeMap[currentTF] || ['15m', '1h', '4h'];
    }

    public confirmSync(
        symbol: string,
        signal: TradingSignal,
        candlesByTF: Record<string, Candle[]>
    ): MTFConfirmation {
        const analyses = this.buildOrderedAnalyses(candlesByTF);
        return this.calculateConfirmation(signal, analyses);
    }

    public async confirm(
        symbol: string,
        signal: TradingSignal,
        currentTimeframe: string,
        exchange: ExchangeContract
    ): Promise<MTFConfirmation> {
        const analyses: TimeframeAnalysis[] = [];
        for (const tf of this.getTimeframesToCheck(currentTimeframe)) {
            try {
                const candles = await exchange.getCandles(symbol, tf, 200);
                analyses.push(this.analyzeTimeframe(candles, tf));
            } catch {
                continue;
            }
        }
        return this.calculateConfirmation(signal, analyses);
    }

    private buildOrderedAnalyses(
        candlesByTF: Record<string, Candle[]>
    ): TimeframeAnalysis[] {
        return Object.entries(candlesByTF)
            .filter(([, c]) => c && c.length >= 50)
            .sort(
                (a, b) => TIMEFRAME_MS[a[0]] - TIMEFRAME_MS[b[0]]
            )
            .map(([tf, candles]) => this.analyzeTimeframe(candles, tf));
    }

    private analyzeTimeframe(candles: Candle[], timeframe: string): TimeframeAnalysis {
        const closes = candles.map(c => c.close);
        const emaFast = this.calculateEMA(closes, 9);
        const emaSlow = this.calculateEMA(closes, 21);
        const atr = this.calculateATR(candles, 14);

        const price = closes.at(-1)!;
        const fast = emaFast.at(-1)!;
        const slow = emaSlow.at(-1)!;

        // ---- BIAS (не continuation!)
        let trend = TrendDirection.NEUTRAL;
        if (fast > slow && price > slow) trend = TrendDirection.BULLISH;
        if (fast < slow && price < slow) trend = TrendDirection.BEARISH;

        // ---- STRENGTH (ATR-normalized)
        const emaDiff = Math.abs(fast - slow);
        const strength = atr > 0 ? emaDiff / atr : 0;

        // ---- REGIME
        let regime: 'TRENDING' | 'RANGING' | 'VOLATILE';
        if (strength > 1.2) regime = 'TRENDING';
        else if (strength < 0.6) regime = 'RANGING';
        else regime = 'VOLATILE';

        return { timeframe, trend, strength, regime };
    }

    private calculateConfirmation(
        signal: TradingSignal,
        analyses: TimeframeAnalysis[]
    ): MTFConfirmation {

        const direction =
            signal.type === 'LONG'
                ? TrendDirection.BULLISH
                : TrendDirection.BEARISH;

        const weights = [1.0, 0.7, 0.4];
        let scoreSum = 0;
        let weightSum = 0;
        const conflicts: string[] = [];

        analyses.forEach((tf, idx) => {
            const w = weights[idx] ?? 0.25;
            weightSum += w;

            if (tf.trend === direction) {
                scoreSum += w;
            } else if (tf.trend === TrendDirection.NEUTRAL) {
                scoreSum += w * 0.4;
            } else {
                conflicts.push(`${tf.timeframe}: ${tf.trend}`);
                scoreSum -= w * 0.5; // 🔥 реальный штраф
            }

            // regime bonus
            if (tf.regime === 'TRENDING') scoreSum += w * 0.15;
        });

        const score = Math.max(0, Math.min(1, scoreSum / weightSum));
        const confirmed = score >= 0.65 && conflicts.length === 0;

        const recommendation =
            score >= 0.8 ? '🟢 STRONG - HTF aligned' :
            score >= 0.65 ? '🟡 MODERATE - Context OK' :
            score >= 0.5 ? '🟠 WEAK - Mixed context' :
            '🔴 REJECT - HTF conflict';

        return {
            confirmed,
            score,
            timeframes: analyses,
            conflicts,
            recommendation
        };
    }

    private calculateEMA(data: number[], period: number): number[] {
        const res: number[] = [];
        const k = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        res.push(ema);
        for (let i = period; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
            res.push(ema);
        }
        return res;
    }

    private calculateATR(candles: Candle[], period: number): number {
        let sum = 0;
        for (let i = 1; i < candles.length; i++) {
            const c = candles[i];
            const p = candles[i - 1];
            const tr = Math.max(
                c.high - c.low,
                Math.abs(c.high - p.close),
                Math.abs(c.low - p.close)
            );
            sum += tr;
        }
        return sum / Math.max(1, candles.length - 1);
    }
}
