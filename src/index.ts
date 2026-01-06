/**
 * Main Entry Point
 * Start the trading bot here
 */

import { TradingBot } from './core/TradingBot';
import { logger } from './services/Logger';

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Process', 'Unhandled Rejection', { reason, promise });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Process', 'Uncaught Exception', error);
  process.exit(1);
});

/**
 * Main function
 */
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║       🤖 ALGO TRADING BOT - Professional Edition         ║
║                                                           ║
║       Strategy: Trend-Following Momentum                  ║
║       Target: 40-50% Win Rate | R:R 1:2-1:3             ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  const bot = new TradingBot();

  // Display bot info
  const info = bot.getInfo();
  console.log('\n📋 Bot Configuration:');
  console.log(`   Mode: ${info.mode}`);
  console.log(`   Symbols: ${info.symbols.join(', ')}`);
  console.log(`   Timeframe: ${info.timeframe}`);
  console.log(`   Leverage: ${info.leverage}x`);
  console.log(`   Risk per trade: ${info.riskPerTrade}`);
  console.log(`   Starting balance: $${info.balance}\n`);

  // Start bot
  try {
    await bot.start();
  } catch (error: any) {
    logger.error('Main', 'Failed to start bot', error.message);
    process.exit(1);
  }
}

// Run the bot
main().catch(error => {
  logger.error('Main', 'Fatal error', error);
  process.exit(1);
});