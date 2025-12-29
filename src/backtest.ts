/**
 * Backtest Runner
 * Run: npm run backtest
 */

import { BacktestEngine } from './core/BacktestEngine';
import { BacktestConfig } from './types';
import { config } from './config/ConfigManager';
import { logger } from './services/Logger';

async function runBacktest() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║              🧪 BACKTEST MODE (29 DAYS)                  ║
║                                                           ║
║       Testing Strategy with Order Flow Data              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Config for 29 days
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  const backtestConfig: BacktestConfig = {
    // 29 Days lookback from now (minus buffer for partial day)
    startDate: new Date(now - (29 * ONE_DAY)),
    endDate: new Date(now - (1 * 60 * 60 * 1000)), // Until 1 hour ago
    
    // Symbols to test (from config)
    symbols: config.getConfig().symbols,
    
    // Starting balance
    initialBalance: config.getRiskConfig().accountBalance,
    
    // Strategy config
    strategy: config.getStrategyConfig(),
    
    // Risk config
    risk: config.getRiskConfig()
  };

  console.log('\n📋 Backtest Configuration:');
  console.log(`   Period: ${backtestConfig.startDate.toISOString().split('T')[0]} to ${backtestConfig.endDate.toISOString().split('T')[0]} (~29 Days)`);
  console.log(`   Symbols: ${backtestConfig.symbols.join(', ')}`);
  console.log(`   Initial Balance: $${backtestConfig.initialBalance}`);
  console.log(`   Risk per Trade: ${backtestConfig.risk.riskPerTrade * 100}%`);
  console.log(`   Leverage: ${backtestConfig.risk.leverage}x\n`);

  // Run backtest
  const engine = new BacktestEngine();
  
  try {
    const result = await engine.run(backtestConfig);
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