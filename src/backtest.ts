/**
 * Backtest Runner
 * Run: npm run backtest
 */

import 'reflect-metadata';
import { container } from './di/container';
import { TYPES } from './di/types';
import { BacktestRunner } from './app/BacktestRunner';
import { BacktestConfig } from './types';
import { config } from './infrastructure/config/ConfigService';
import { logger } from './infrastructure/logging/Logger';

async function runBacktest() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║              🧪 BACKTEST MODE                            ║
║                                                           ║
║       Testing Strategy on Historical Data                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Configure backtest
  const backtestConfig: BacktestConfig = {
    // Test last 30 days
    startDate: new Date('2025-01-01 00:00:00'),
    endDate: new Date('2025-12-30 23:59:59'),

    // Symbols to test
    symbols: config.getConfig().symbols,

    // Starting balance
    initialBalance: config.getRiskConfig().accountBalance,

    // Strategy config
    strategy: config.getStrategyConfig(),

    // Risk config
    risk: config.getRiskConfig()
  };

  console.log('\n📋 Backtest Configuration:');
  console.log(`   Period: ${backtestConfig.startDate.toISOString().split('T')[0]} to ${backtestConfig.endDate.toISOString().split('T')[0]}`);
  console.log(`   Symbols: ${backtestConfig.symbols.join(', ')}`);
  console.log(`   Initial Balance: $${backtestConfig.initialBalance}`);
  console.log(`   Risk per Trade: ${backtestConfig.risk.riskPerTrade * 100}%`);
  console.log(`   Leverage: ${backtestConfig.risk.leverage}x`);
  console.log(`   Max gap entry: ${(backtestConfig.risk.maxGapEntryPercent * 100).toFixed(2)}% (reject if worse)\n`);

  // Run backtest
  const engine = container.get<BacktestRunner>(TYPES.BacktestEngine);

  try {
    const result = await engine.run(backtestConfig);

    // Results are displayed by the engine
    process.exit(0);

  } catch (error: any) {
    logger.error('Backtest', 'Backtest failed', error.message);
    process.exit(1);
  }
}

// Run backtest
runBacktest().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});