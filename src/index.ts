/**
 * Main Entry Point
 * Start the trading bot here
 */
import express from 'express';
import type { Request, Response } from 'express';
import { TradingBot } from './core/TradingBot';
import { logger } from './services/Logger';
import * as readline from 'readline';

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

    // Setup command interface
    setupCommandInterface(bot);

  } catch (error: any) {
    logger.error('Main', 'Failed to start bot', error.message);
    process.exit(1);
  }
}

/**
 * Setup interactive command interface
 */
function setupCommandInterface(bot: TradingBot) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n> '
  });

  console.log('\n📝 Available commands:');
  console.log('   status    - Show bot status');
  console.log('   stats     - Show performance stats');
  console.log('   stop      - Stop the bot');
  console.log('   emergency - Emergency stop (close all positions)');
  console.log('   help      - Show this help\n');

  rl.prompt();

  rl.on('line', async (input: string) => {
    const command = input.trim().toLowerCase();

    switch (command) {
      case 'status':
        const info = bot.getInfo();
        console.log('\n📊 Bot Status:');
        console.log(`   Status: ${info.status}`);
        console.log(`   Balance: $${info.balance.toFixed(2)}`);
        console.log(`   Mode: ${info.mode}`);
        break;

      case 'stats':
      case 'performance':
        const stats = bot.getPerformanceSummary(30);
        console.log('\n📈 Performance (Last 30 days):');
        console.log(`   Total Trades: ${stats.totalTrades}`);
        console.log(`   Wins: ${stats.wins} | Losses: ${stats.losses}`);
        console.log(`   Win Rate: ${stats.winRate.toFixed(2)}%`);
        console.log(`   Avg Win: $${stats.avgWin.toFixed(2)}`);
        console.log(`   Avg Loss: $${stats.avgLoss.toFixed(2)}`);
        console.log(`   Profit Factor: ${stats.profitFactor.toFixed(2)}`);
        console.log(`   Total Return: ${stats.totalReturn.toFixed(2)}%`);
        console.log(`   Total PnL: $${stats.totalPnL.toFixed(2)}`);
        console.log(`   Drawdown: ${stats.drawdown.toFixed(2)}%`);
        break;

      case 'stop':
        console.log('\n🛑 Stopping bot...');
        await bot.stop();
        console.log('✅ Bot stopped');
        rl.close();
        process.exit(0);
        break;

      case 'emergency':
        console.log('\n🚨 Emergency stop initiated...');
        await bot.emergencyStop();
        console.log('✅ All positions closed, bot stopped');
        rl.close();
        process.exit(0);
        break;

      case 'help':
        console.log('\n📝 Available commands:');
        console.log('   status    - Show bot status');
        console.log('   stats     - Show performance stats');
        console.log('   stop      - Stop the bot');
        console.log('   emergency - Emergency stop (close all positions)');
        console.log('   help      - Show this help');
        break;

      case '':
        // Empty input, just show prompt again
        break;

      default:
        console.log(`❌ Unknown command: ${command}`);
        console.log('Type "help" for available commands');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Goodbye!');
    process.exit(0);
  });

  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Received SIGINT, stopping bot...');
    await bot.stop();
    process.exit(0);
  });
}

// Run the bot
main().catch(error => {
  logger.error('Main', 'Fatal error', error);
  process.exit(1);
});