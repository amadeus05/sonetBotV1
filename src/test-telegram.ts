/**
 * Telegram Test Script
 * Standalone script to verify Telegram bot configuration
 * 
 * Usage: npx ts-node src/test-telegram.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { TelegramService, TelegramConfig } from './services/TelegramService';

async function main() {
    console.log('🤖 Telegram Bot Test\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // 1. Check environment variables
    const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = process.env.TELEGRAM_CHAT_ID || '';
    const enabled = process.env.TELEGRAM_ENABLED !== 'false';

    console.log(`📋 Configuration:`);
    console.log(`   Bot Token: ${botToken ? '✅ Set (' + botToken.substring(0, 10) + '...)' : '❌ Missing'}`);
    console.log(`   Chat ID:   ${chatId ? '✅ Set (' + chatId + ')' : '❌ Missing'}`);
    console.log(`   Enabled:   ${enabled ? '✅ Yes' : '⚠️ No (TELEGRAM_ENABLED=false)'}`);
    console.log('');

    if (!botToken || !chatId) {
        console.log('❌ Missing required environment variables!');
        console.log('');
        console.log('Please add to your .env file:');
        console.log('   TELEGRAM_BOT_TOKEN=your_bot_token');
        console.log('   TELEGRAM_CHAT_ID=your_chat_id');
        console.log('');
        console.log('How to get these values:');
        console.log('   1. Create bot: https://t.me/BotFather -> /newbot');
        console.log('   2. Get Chat ID: https://t.me/userinfobot or message your bot and check:');
        console.log('      https://api.telegram.org/bot<TOKEN>/getUpdates');
        process.exit(1);
    }

    if (!enabled) {
        console.log('⚠️ Telegram is disabled (TELEGRAM_ENABLED=false)');
        console.log('   Set TELEGRAM_ENABLED=true to enable notifications.');
        process.exit(0);
    }

    // 2. Initialize TelegramService
    const config: TelegramConfig = {
        botToken,
        chatId,
        enabled: true
    };

    // Reset singleton for clean test
    TelegramService.resetInstance();
    const telegram = TelegramService.getInstance(config);

    // 3. Send test message
    console.log('📤 Sending test message...');

    const success = await telegram.sendTestMessage();

    if (success) {
        console.log('');
        console.log('✅ Telegram test passed!');
        console.log('   Check your Telegram for the test message.');
    } else {
        console.log('');
        console.log('❌ Failed to send test message!');
        console.log('   Please check:');
        console.log('   - Bot token is correct');
        console.log('   - Chat ID is correct');
        console.log('   - Bot has been started (send /start to your bot)');
        console.log('   - Bot is added to group/channel if using group Chat ID');
        process.exit(1);
    }

    // 4. Test trade notifications (optional)
    console.log('');
    console.log('📊 Testing trade notification formats...');

    // Test entry notification
    const entrySuccess = await telegram.notifyTradeEntry({
        symbol: 'BTCUSDT',
        type: 'LONG',
        size: 500.00,
        entryPrice: 95234.50,
        takeProfit: 97123.00,
        stopLoss: 94100.00,
        balance: 4500.00
    });

    if (entrySuccess) {
        console.log('   ✅ Entry notification sent');
    } else {
        console.log('   ❌ Entry notification failed');
    }

    // Small delay between messages
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test exit notification
    const exitSuccess = await telegram.notifyTradeExit({
        symbol: 'BTCUSDT',
        type: 'LONG',
        exitPrice: 97100.00,
        pnl: 187.50,
        pnlPercent: 3.75,
        commission: 0.95,
        reason: 'TP',
        balance: 4687.50
    });

    if (exitSuccess) {
        console.log('   ✅ Exit notification sent');
    } else {
        console.log('   ❌ Exit notification failed');
    }

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 All tests completed!');
}

main().catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
});
