/**
 * Main Entry Point (Clean Architecture)
 * 
 * Uses InversifyJS DI container to resolve dependencies.
 * IMPORTANT: reflect-metadata must be imported FIRST.
 */

import 'reflect-metadata';
import { container } from './di/container';
import { TYPES } from './di/types';
import { TradingBot } from './app/TradingBot';

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

/**
 * Main function
 */
async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║       🤖 ALGO TRADING BOT - Clean Architecture           ║
║                                                           ║
║       Phase 1: DI + Domain Layer Proof of Concept        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Resolve TradingBot from DI container
  // This automatically injects IExchange -> BinanceAdapter
  const bot = container.get<TradingBot>(TYPES.TradingBot);

  console.log('📦 [DI] TradingBot resolved from container');
  console.log('📦 [DI] IExchange bound to BinanceAdapter');

  // Run the bot
  try {
    await bot.start();
  } catch (error: any) {
    console.error('❌ [Main] Failed to start bot:', error.message);
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('❌ [Main] Fatal error:', error);
  process.exit(1);
});