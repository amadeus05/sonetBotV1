/**
 * Strategy Engine
 * Responsibility: Orchestrate all analysis modules and generate trading signals
 * This is the BRAIN of the bot
 */

import { 
    Candle, 
    MarketData, 
    TradingSignal, 
    SignalType,
    TrendDirection,
    MarketRegime 
  } from '../types';
  import { TrendAnalyzer } from '../modules/TrendAnalyzer';
  import { MomentumDetector } from '../modules/MomentumDetector';
  import { PullbackScanner } from '../modules/PullbackScanner';
  import { RegimeDetector } from '../modules/RegimeDetector';
  import { OrderFlowValidator } from '../modules/OrderFlowValidator';
  import { RiskManager } from './RiskManager';
  import { SessionFilter, MarketSession } from '../utils/SessionFilter'; 
  import { logger } from '../services/Logger';
  
  export class StrategyEngine {
    private trendAnalyzer: TrendAnalyzer;
    private momentumDetector: MomentumDetector;
    private pullbackScanner: PullbackScanner;
    private regimeDetector: RegimeDetector;
    private orderFlowValidator: OrderFlowValidator;
    private riskManager: RiskManager;
  
    constructor(riskManager: RiskManager) {
      this.trendAnalyzer = new TrendAnalyzer();
      this.momentumDetector = new MomentumDetector();
      this.pullbackScanner = new PullbackScanner();
      this.regimeDetector = new RegimeDetector();
      this.orderFlowValidator = new OrderFlowValidator();
      this.riskManager = riskManager;
  
      logger.info('StrategyEngine', 'Initialized with all modules');
    }
  
    /**
     * Main analysis function - generates trading signals
     */
    public async analyze(marketData: MarketData): Promise<TradingSignal | null> {
      const { symbol, candles, orderFlow } = marketData;
  
      logger.debug('StrategyEngine', `Analyzing ${symbol}...`);
  
      // STEP 1: Detect Market Regime
      const regime = this.regimeDetector.detect(candles);
      
      // Only trade in TRENDING regime (our strategy)
      if (!this.regimeDetector.isTrendingRegime(regime)) {
        logger.debug('StrategyEngine', `${symbol}: Not trending regime (${regime})`);
        return null;
      }
  
      // STEP 2: Analyze Trend
      const trend = this.trendAnalyzer.analyze(candles);
      
      if (!trend.isStrong || trend.direction === TrendDirection.NEUTRAL) {
        logger.debug('StrategyEngine', `${symbol}: No strong trend`, {
          direction: trend.direction,
          strength: trend.strength
        });
        return null;
      }
  
      // STEP 3: Detect Momentum Spike
      const momentum = this.momentumDetector.detect(candles);
      
      if (!momentum.hasSpike) {
        logger.debug('StrategyEngine', `${symbol}: No momentum spike`);
        return null;
      }
  
      // Check momentum direction aligns with trend
      if (momentum.direction !== trend.direction) {
        logger.debug('StrategyEngine', `${symbol}: Momentum/trend mismatch`, {
          momentum: momentum.direction,
          trend: trend.direction
        });
        return null;
      }
  
      // STEP 4: Check for Pullback
      const pullback = this.pullbackScanner.scan(candles, trend);
      
      if (!pullback.occurred || !pullback.isValid) {
        logger.debug('StrategyEngine', `${symbol}: No valid pullback`);
        return null;
      }
  
      // Check if price is bouncing off pullback level
      if (!this.pullbackScanner.isBouncing(candles, pullback, trend.direction)) {
        logger.debug('StrategyEngine', `${symbol}: Not bouncing yet`);
        return null;
      }
  
      // STEP 5: Order Flow Validation (if available)
      const orderFlowConfirmation = this.orderFlowValidator.validate(
        orderFlow,
        trend.direction
      );
  
      if (!orderFlowConfirmation.confirmed) {
        logger.debug('StrategyEngine', `${symbol}: Order flow not confirmed`, {
          score: orderFlowConfirmation.score
        });
        return null;
      }

      const currentTimestamp = candles[candles.length - 1].timestamp;
      const session = SessionFilter.getSession(currentTimestamp);
  
      // STEP 6: Generate Signal
      const signal = this.generateSignal(
        symbol,
        candles,
        trend.direction,
        {
          trend,
          momentum,
          pullback,
          orderFlow: orderFlowConfirmation,
          regime,
          session,
        }
      );
  
      if (!signal) {
        return null;
      }
  
      // STEP 7: Validate with Risk Manager
      const validation = this.riskManager.validateSignal(signal);
      
      if (!validation.valid) {
        logger.warn('StrategyEngine', `${symbol}: Signal rejected by risk manager`, {
          reason: validation.reason
        });
        return null;
      }
  
      logger.signal(symbol, '🎯 SIGNAL GENERATED', {
        type: signal.type,
        entry: signal.entry,
        sl: signal.stopLoss,
        tp: signal.takeProfit,
        confidence: signal.confidence,
        tags: signal.tags
      });
  
      return signal;
    }
  
    /**
     * Generate trading signal with entry, SL, TP
     */
    private generateSignal(
      symbol: string,
      candles: Candle[],
      direction: TrendDirection,
      analysis: any
    ): TradingSignal | null {
      const currentPrice = candles[candles.length - 1].close;
      
      // Determine signal type
      const signalType = direction === TrendDirection.BULLISH ? 
                         SignalType.LONG : SignalType.SHORT;
  
      // Entry: current price (market order)
      const entry = currentPrice;
  
      // Stop Loss: calculated using ATR
      const isLong = signalType === SignalType.LONG;
      const stopLoss = this.riskManager.calculateStopLoss(candles, entry, isLong);
  
      // Take Profit: based on R:R ratio
      const takeProfit = this.riskManager.calculateTakeProfit(entry, stopLoss, isLong);
      
      // ИСПРАВЛЕНИЕ: Сначала считаем уверенность!
      // Calculate confidence score
      const confidence = this.calculateConfidence(analysis);
  
      // Calculate position size
      const tempSignal: TradingSignal = {
        symbol,
        type: signalType,
        entry,
        stopLoss,
        takeProfit,
        positionSize: 0, 
        confidence: confidence, // <-- ИСПРАВЛЕНИЕ: Передаем рассчитанную уверенность
        timestamp: Date.now(),
        tags: [],
        metadata: analysis
      };
  
      const positionSize = this.riskManager.calculatePositionSize(tempSignal, candles);
  
      // Generate tags
      const tags = this.generateTags(analysis);
  
      return {
        symbol,
        type: signalType,
        entry,
        stopLoss,
        takeProfit,
        positionSize: positionSize.size, // Теперь здесь будет не 0
        confidence,
        timestamp: Date.now(),
        tags,
        metadata: analysis
      };
    }
  
    /**
     * Calculate overall signal confidence (0-1)
     */
    private calculateConfidence(analysis: any): number {
      let score = 0;
  
      // Trend strength (40%)
      score += analysis.trend.strength * 0.4;
  
      // Momentum score (30%)
      const momentumScore = this.momentumDetector.calculateMomentumScore(analysis.momentum);
      score += momentumScore * 0.3;
  
      // Pullback quality (20%)
      const pullbackScore = this.pullbackScanner.calculatePullbackScore(
        analysis.pullback,
        [],
        analysis.trend.direction
      );
      score += pullbackScore * 0.2;
  
      // Order flow confirmation (10%)
      if (analysis.orderFlow) {
        score += analysis.orderFlow.score * 0.1;
      }
  
      return Math.min(score, 1);
    }
  
    /**
     * Generate descriptive tags for the signal
     */
    private generateTags(analysis: any): string[] {
      const tags: string[] = [];

      // Add Session Tag
      tags.push(`session:${analysis.session}`);
  
      // Regime tag
      tags.push(`regime:${analysis.regime}`);
  
      // Trend tags
      tags.push(`trend:${analysis.trend.direction}`);
      if (analysis.trend.strength > 0.7) tags.push('strong_trend');
  
      // Momentum tags
      if (analysis.momentum.hasSpike) {
        tags.push('momentum_spike');
        tags.push(`rsi:${Math.round(analysis.momentum.rsi)}`);
      }
      if (analysis.momentum.volumeRatio > 2) {
        tags.push('volume_explosion');
      }
  
      // Pullback tags
      if (analysis.pullback.occurred) {
        tags.push('pullback_entry');
      }
  
      // Order flow tags
      // if (analysis.orderFlow) {
      //   if (analysis.orderFlow.cvdAligned) tags.push('cvd_aligned');
      //   if (analysis.orderFlow.oiConfirmed) tags.push('oi_confirmed');
      //   if (analysis.orderFlow.liquidationsSupport) tags.push('liq_support');
      // }
  
      return tags;
    }
  
    /**
     * Check if we should close an existing position
     */
    public shouldClosePosition(
      position: any,
      candles: Candle[]
    ): { shouldClose: boolean; reason?: string } {
      // Check for regime change
      const regime = this.regimeDetector.detect(candles);
      if (regime === MarketRegime.VOLATILE) {
        return { shouldClose: true, reason: 'Regime changed to volatile' };
      }
  
      // Check for trend reversal
      const trend = this.trendAnalyzer.analyze(candles);
      const positionDirection = position.side === 'LONG' ? 
                                TrendDirection.BULLISH : TrendDirection.BEARISH;
  
      if (trend.direction !== positionDirection && trend.isStrong) {
        return { shouldClose: true, reason: 'Trend reversed' };
      }
  
      // Check for momentum divergence
      const divergence = this.momentumDetector.detectDivergence(candles);
      if (position.side === 'LONG' && divergence.bearishDiv) {
        return { shouldClose: true, reason: 'Bearish divergence detected' };
      }
      if (position.side === 'SHORT' && divergence.bullishDiv) {
        return { shouldClose: true, reason: 'Bullish divergence detected' };
      }
  
      return { shouldClose: false };
    }
  
    /**
     * Get strategy status summary
     */
    public getStatusSummary(candles: Candle[]): string {
      const regime = this.regimeDetector.detect(candles);
      const trend = this.trendAnalyzer.analyze(candles);
      const momentum = this.momentumDetector.detect(candles);
  
      return `${this.regimeDetector.getRegimeSummary(regime, candles)}\n` +
             `${this.trendAnalyzer.getTrendSummary(trend)}\n` +
             `${this.momentumDetector.getMomentumSummary(momentum)}`;
    }
  }