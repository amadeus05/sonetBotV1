/**
 * Core Types for Algo Trading Bot
 * Following SOLID principles with clear separation of concerns
 */

// ============================================
// MARKET DATA TYPES
// ============================================

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;

  takerBuyBaseVolume: number;
  openInterest: number;
}

export interface MarketData {
  symbol: string;
  candles: Candle[];
  lastPrice: number;
}

// ============================================
// STRATEGY TYPES
// ============================================

export enum TrendDirection {
  BULLISH = 'BULLISH',
  BEARISH = 'BEARISH',
  NEUTRAL = 'NEUTRAL'
}

export enum MarketRegime {
  TRENDING = 'TRENDING',
  RANGING = 'RANGING',
  VOLATILE = 'VOLATILE',
  UNKNOWN = 'UNKNOWN'
}

export enum SignalType {
  LONG = 'LONG',
  SHORT = 'SHORT',
  CLOSE_LONG = 'CLOSE_LONG',
  CLOSE_SHORT = 'CLOSE_SHORT'
}

export interface TrendAnalysis {
  direction: TrendDirection;
  strength: number;        // 0-1, where 1 is strongest
  emaFast: number;
  emaSlow: number;
  isStrong: boolean;
}

export interface MomentumSignal {
  hasSpike: boolean;
  rsi: number;
  volumeRatio: number;    // Current volume / Average volume
  priceChange: number;    // % change
  direction: TrendDirection;
  spikeReasons?: {        // <-- НОВОЕ ПОЛЕ
    rsi: boolean;
    volume: boolean;
    price: boolean;
  };
  // Fields for StrategyEngine momentum pullback
  high: number;           // Impulse high price
  low: number;            // Impulse low price  
  atr: number;            // ATR at impulse detection
}

export interface PullbackAnalysis {
  occurred: boolean;
  distanceFromEMA: number;  // % distance
  level: number;             // Price level
  isValid: boolean;
  // Fields for StrategyEngine
  low: number;              // Pullback low price
  high: number;             // Pullback high price
}

export enum MarketSession {
  ASIA = 'ASIA',
  LONDON = 'LONDON',
  NY = 'NY',
  OFF = 'OFF'
}

export interface TradingSignal {
  symbol: string;
  type: SignalType;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;  // 0-1
  timestamp: number;
  tags: string[];
  metadata: any;  // Can be legacy structure or MomentumSetup from StrategyEngine  
}

// ============================================
// POSITION & TRADE TYPES
// ============================================

export enum PositionSide {
  LONG = 'LONG',
  SHORT = 'SHORT'
}

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  PENDING = 'PENDING'
}

export enum TradeExitReason {
  TAKE_PROFIT = 'TP',
  STOP_LOSS = 'SL',
  TRAILING_STOP = 'TRAILING',
  MANUAL = 'MANUAL',
  EXPIRED = 'EXPIRED',
  REGIME_CHANGE = 'REGIME_CHANGE'
}

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  entry: number;
  size: number;
  quantity: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;

  // RR-driven position management (partial exit + BE + trailing)
  initialSize?: number;            // initial notional size in USD
  remainingSize?: number;          // remaining notional size in USD
  initialStopLoss?: number;        // initial SL at entry (for achieved RR calc)
  tp1Price?: number;               // 1R level (partial exit)
  tp1Fraction?: number;            // fraction to close at 1R (e.g. 0.7)
  partialTaken?: boolean;
  realizedPnL?: number;            // realized PnL from partial exits (net of fees on those exits)
  trailingActive?: boolean;
  trailingDistance?: number;        // ATR-based trailing distance in price units
  trailingStop?: number;            // current trailing stop price (updated bar-by-bar)
  trailingAnchor?: number;          // highest high (long) / lowest low (short) since trail activation
  breakEvenPrice?: number;          // entry price (BE stop level after partial)

  meta?: any;
  openTime: number;
  closeTime?: number;
  closePrice?: number;
  pnl?: number;
  pnlPercent?: number;
  status: PositionStatus;
  exitReason?: TradeExitReason;
  tags: string[];
}

export interface TradeResult {
  position: Position;
  won: boolean;
  rr: number;  // Risk:Reward ratio achieved
  holdTime: number;  // milliseconds
  slippage: number;
}

// ============================================
// RISK MANAGEMENT TYPES
// ============================================

export interface RiskParameters {
  accountBalance: number;
  riskPerTrade: number;      // % of account
  maxOpenTrades: number;
  leverage: number;
  maxDailyLoss: number;      // % max loss per day
  maxDrawdown: number;       // % max drawdown
  minRR: number;
}

export interface FeeConfig {
  maker: number; // e.g. 0.0002 = 0.02%
  taker: number; // e.g. 0.0005 = 0.05%
}

export interface PositionSizeCalculation {
  size: number;              // Position size in USD
  quantity: number;          // Quantity in base asset
  risk: number;              // $ amount at risk
  riskPercent: number;
  leverage: number;
}

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface StrategyConfig {
  // Trend Filter
  emaFast: number;
  emaSlow: number;
  minTrendStrength: number;

  // Momentum
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  volumeSpikeMultiplier: number;

  // Pullback
  pullbackToEMA: boolean;
  maxPullbackDistance: number;

  // Order Flow
  cvdThreshold: number;
  oiChangeMin: number;
  checkLiquidations: boolean;

  // Entry/Exit
  stopLossATRMultiplier: number;
  takeProfitRatio: number;
  trailingStop: boolean;

  // Filters
  minVolume: number;
  maxSpread: number;
  btcSyncRequired: boolean;
}

export interface BotConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  symbols: string[];
  timeframe: string;
  strategy: StrategyConfig;
  risk: RiskParameters;
  fees: FeeConfig;
}

// ============================================
// BACKTEST TYPES
// ============================================

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  symbols: string[];
  initialBalance: number;
  strategy: StrategyConfig;
  risk: RiskParameters;
}

export interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  averageRR: number;
  profitFactor: number;
  finalBalance: number;
  totalPnL: number;
  totalPnLPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  expectancy: number;
  sharpeRatio: number;
  trades: TradeResult[];
  equityCurve: { timestamp: number; balance: number; equity: number }[];
}

// ============================================
// EXCHANGE TYPES
// ============================================

export interface ExchangeOrder {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'STOP_MARKET' | 'TAKE_PROFIT_MARKET';
  quantity: number;
  price?: number;
  stopPrice?: number;
  status: 'NEW' | 'FILLED' | 'CANCELED' | 'REJECTED';
  timestamp: number;
}

export interface ExchangeBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

// ============================================
// LOGGER TYPES
// ============================================

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
}

// ============================================
// TELEGRAM TYPES
// ============================================

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}