import { Candle, TradingSignal, TrendDirection } from '../types';
import { BinanceService } from '../services/BinanceService';

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

// ---- Timeframe duration in milliseconds
const TIMEFRAME_MS: Record<string, number> = {
    '1m': 60_000,
    '3m': 3 * 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '30m': 30 * 60_000,
    '1h': 60 * 60_000,
    '4h': 4 * 60 * 60_000,
    '1d': 24 * 60 * 60_000,
    '1w': 7 * 24 * 60 * 60_000
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

    /**
     * BACKTEST / SYNC MODE
     * candlesByTF MUST already be aggregated by timeframe
     */
    public confirmSync(
        symbol: string,
        signal: TradingSignal,
        candlesByTF: Record<string, Candle[]>
    ): MTFConfirmation {
        const analyses = this.buildOrderedAnalyses(candlesByTF);
        return this.calculateConfirmation(signal, analyses);
    }

    /**
     * LIVE MODE (kept for backward compatibility)
     * ⚠️ Not recommended for new architecture
     */
    public async confirm(
        symbol: string,
        signal: TradingSignal,
        currentTimeframe: string,
        binanceService: BinanceService
    ): Promise<MTFConfirmation> {

        const analyses: TimeframeAnalysis[] = [];

        for (const tf of this.getTimeframesToCheck(currentTimeframe)) {
            try {
                const candles = await binanceService.getCandles(symbol, tf, 200);
                if (candles.length < 50) continue;

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
            .filter(([tf, candles]) =>
                TIMEFRAME_MS[tf] !== undefined && candles && candles.length >= 50
            )
            .sort((a, b) => TIMEFRAME_MS[a[0]] - TIMEFRAME_MS[b[0]])
            .map(([tf, candles]) => this.analyzeTimeframe(candles, tf));
    }

    private analyzeTimeframe(
        candles: Candle[],
        timeframe: string
    ): TimeframeAnalysis {

        // ---- Warm-up protection
        if (candles.length < 60) {
            return {
                timeframe,
                trend: TrendDirection.NEUTRAL,
                strength: 0,
                regime: 'RANGING'
            };
        }

        const closes = candles.map(c => c.close);

        const emaFast = this.calculateEMA(closes, 9);
        const emaSlow = this.calculateEMA(closes, 21);
        const atr = this.calculateATR(candles, 14);

        const price = closes.at(-1)!;
        const fast = emaFast.at(-1)!;
        const slow = emaSlow.at(-1)!;

        // ---- TREND BIAS (context, not entry)
        let trend = TrendDirection.NEUTRAL;
        if (fast > slow && price > slow) trend = TrendDirection.BULLISH;
        else if (fast < slow && price < slow) trend = TrendDirection.BEARISH;

        // ---- STRENGTH (ATR-normalized)
        const emaDiff = Math.abs(fast - slow);
        const strength = atr > 0 ? emaDiff / atr : 0;

        // ---- REGIME CLASSIFICATION
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

        let scoreSum = 0;
        let weightSum = 0;
        const conflicts: string[] = [];

        for (const tf of analyses) {
            // ---- Deterministic weight (bigger TF = lower weight)
            const w = 1 / TIMEFRAME_MS[tf.timeframe];
            weightSum += w;

            if (tf.trend === direction) {
                scoreSum += w;
            } else if (tf.trend === TrendDirection.NEUTRAL) {
                scoreSum += w * 0.4;
            } else {
                conflicts.push(`${tf.timeframe}: ${tf.trend}`);
                scoreSum -= w * 0.5;
            }

            if (tf.regime === 'TRENDING') {
                scoreSum += w * 0.15;
            }
        }

        const rawScore = weightSum > 0 ? scoreSum / weightSum : 0;
        const score = Math.max(0, Math.min(1, rawScore));

        // ---- Conflict policy (HTF > LTF)
        const hardConflict = conflicts.some(c =>
            c.startsWith('1h') || c.startsWith('4h') || c.startsWith('1d')
        );

        const confirmed = score >= 0.65 && !hardConflict;

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
        if (data.length < period) return [];

        const res: number[] = [];
        const k = 2 / (period + 1);

        let ema =
            data.slice(0, period).reduce((a, b) => a + b, 0) / period;

        res.push(ema);

        for (let i = period; i < data.length; i++) {
            ema = data[i] * k + ema * (1 - k);
            res.push(ema);
        }

        return res;
    }

    private calculateATR(candles: Candle[], period: number): number {
        if (candles.length < period + 1) return 0;

        let sum = 0;
        const start = candles.length - period;

        for (let i = start; i < candles.length; i++) {
            const c = candles[i];
            const p = candles[i - 1];
            const tr = Math.max(
                c.high - c.low,
                Math.abs(c.high - p.close),
                Math.abs(c.low - p.close)
            );
            sum += tr;
        }

        return sum / period;
    }
}
