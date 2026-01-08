/**
 * DI Container Configuration
 * 
 * Central place for dependency injection setup using InversifyJS.
 * Binds abstractions (interfaces) to concrete implementations.
 */

import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from './types';

// Domain Interfaces
import { IExchange } from '../domain/interfaces/IExchange';
import { IIndicators } from '../domain/interfaces/IIndicators';
import { IRiskManager } from '../domain/interfaces/IRiskManager';
import { IStrategy } from '../domain/interfaces/IStrategy';

// Domain Services
import { TechnicalIndicators } from '../domain/services/TechnicalIndicators';
import { RiskManager } from '../domain/services/RiskManager';

// Infrastructure Adapters
import { BinanceAdapter } from '../infrastructure/exchanges/binance/BinanceAdapter';

// Legacy Services (for backward compatibility during migration)
import { BinanceService } from '../infrastructure/exchanges/binance/BinanceService';
import { Logger, logger } from '../infrastructure/logging/Logger';
import { DatabaseManager, db } from '../infrastructure/persistence/DatabaseManager';
import { MarketDataManager } from '../app/services/MarketDataManager';

// Core (Domain Strategies)
import { StrategyEngine } from '../domain/strategies/StrategyEngine';
import { TradeExecutor } from '../app/services/TradeExecutor';
import { BacktestEngine } from '../app/BacktestEngine';

// App Layer (Clean Architecture)
import { TradingBot } from '../app/TradingBot';

// Modules (Domain Analysis)
import { TrendAnalyzer } from '../domain/analysis/TrendAnalyzer';
import { MomentumDetector } from '../domain/analysis/MomentumDetector';
import { PullbackScanner } from '../domain/analysis/PullbackScanner';
import { RegimeDetector } from '../domain/analysis/RegimeDetector';

// Config - New Clean Architecture
import { ConfigService } from '../infrastructure/config/ConfigService';

// Config - Legacy (for backward compatibility)
import { ConfigManager, config } from '../infrastructure/config/ConfigService';

const container = new Container();

// ============================================
// DOMAIN LAYER BINDINGS (Pure Business Logic)
// ============================================

// Bind IExchange interface to BinanceAdapter implementation
container.bind<IExchange>(TYPES.IExchange).to(BinanceAdapter).inSingletonScope();

// Bind IConfigService to ConfigService
container.bind<ConfigService>(TYPES.IConfigService).to(ConfigService).inSingletonScope();

// Bind IIndicators to TechnicalIndicators (stateless calculations)
container.bind<IIndicators>(TYPES.IIndicators).to(TechnicalIndicators).inSingletonScope();

// Bind IRiskManager to RiskManager (pure domain service, no DB access)
container.bind<IRiskManager>(TYPES.IRiskManager).to(RiskManager).inSingletonScope();

// Bind IStrategy to StrategyEngine (momentum pullback strategy)
container.bind<IStrategy>(TYPES.IStrategy).to(StrategyEngine).inSingletonScope();

// ============================================
// SINGLETONS (Services & Config)
// Note: These use toConstantValue() because they have private constructors
// ============================================

container.bind<Logger>(TYPES.Logger).toConstantValue(logger);
container.bind<DatabaseManager>(TYPES.DatabaseManager).toConstantValue(db);
container.bind<ConfigService>(TYPES.ConfigManager).toConstantValue(config);
container.bind<BinanceService>(TYPES.BinanceService).to(BinanceService).inSingletonScope();

// ============================================
// TRANSIENT (New instance per request)
// ============================================

// Modules
container.bind<TrendAnalyzer>(TYPES.TrendAnalyzer).to(TrendAnalyzer);
container.bind<MomentumDetector>(TYPES.MomentumDetector).to(MomentumDetector);
container.bind<PullbackScanner>(TYPES.PullbackScanner).to(PullbackScanner);
container.bind<RegimeDetector>(TYPES.RegimeDetector).to(RegimeDetector);

// Core
container.bind<StrategyEngine>(TYPES.StrategyEngine).to(StrategyEngine);
container.bind<TradeExecutor>(TYPES.TradeExecutor).to(TradeExecutor);
container.bind<MarketDataManager>(TYPES.MarketDataManager).to(MarketDataManager);
container.bind<TradingBot>(TYPES.TradingBot).to(TradingBot);
container.bind<BacktestEngine>(TYPES.BacktestEngine).to(BacktestEngine);

export { container };
