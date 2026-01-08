/**
 * DI Types - Symbols for dependency injection
 * 
 * Using symbols ensures unique identifiers for each dependency,
 * preventing name collisions and enabling proper InversifyJS binding.
 */

export const TYPES = {
    // Domain Interfaces
    IExchange: Symbol.for('IExchange'),
    IConfigService: Symbol.for('IConfigService'),
    IIndicators: Symbol.for('IIndicators'),
    IRiskManager: Symbol.for('IRiskManager'),
    IStrategy: Symbol.for('IStrategy'),

    // Application Layer
    TradingBot: Symbol.for('TradingBot'),

    // Legacy Services (for backward compatibility)
    Logger: Symbol.for('Logger'),
    DatabaseManager: Symbol.for('DatabaseManager'),
    ConfigManager: Symbol.for('ConfigManager'),
    BinanceService: Symbol.for('BinanceService'),
    MarketDataManager: Symbol.for('MarketDataManager'),

    // Core
    StrategyEngine: Symbol.for('StrategyEngine'),
    TradeExecutor: Symbol.for('TradeExecutor'),
    BacktestEngine: Symbol.for('BacktestEngine'),

    // Modules
    TrendAnalyzer: Symbol.for('TrendAnalyzer'),
    MomentumDetector: Symbol.for('MomentumDetector'),
    PullbackScanner: Symbol.for('PullbackScanner'),
    RegimeDetector: Symbol.for('RegimeDetector'),
};
