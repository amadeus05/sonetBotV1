/**
 * Main Entry Point
 * Start the trading bot here
 */
import express from 'express';
import type { Request, Response } from 'express';
import { TradingBot } from './core/TradingBot';
import { logger } from './services/Logger';

const server = express();
server.use(express.json());
const PORT: number = Number(process.env.PORT) || 8000; // Render требует переменную PORT

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Process', 'Unhandled Rejection', { reason, promise });
});

server.get('/health', (_req: Request, res: Response) => {
  res.status(200).send('Algo Trading Bot is alive!');
});

server.get('/', (_req: Request, res: Response) => {
  res.send('<h1>Algo Trading Bot is alive!</h1><p>/health — <- check health <3 </p>');
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server listening on port ${PORT}`);
  });

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