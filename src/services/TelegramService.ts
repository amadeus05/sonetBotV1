/**
 * Telegram Service
 * Responsibility: Send trade notifications to Telegram
 */

import axios from 'axios';
import { logger } from './Logger';

export interface TelegramConfig {
    botToken: string;
    chatId: string;
    enabled: boolean;
}

export interface TradeEntryNotification {
    symbol: string;
    type: 'LONG' | 'SHORT';
    size: number;          // Position size in USD
    entryPrice: number;
    takeProfit: number;
    stopLoss: number;
    balance: number;       // Current account balance
}

export interface TradeExitNotification {
    symbol: string;
    type: 'LONG' | 'SHORT';
    exitPrice: number;
    pnl: number;           // Net PnL in USD
    pnlPercent: number;    // PnL as percentage
    commission: number;    // Fees paid
    reason: string;        // Exit reason (TP, SL, MANUAL, etc.)
    balance: number;       // Current account balance
}

export class TelegramService {
    private static instance: TelegramService | null = null;
    private botToken: string;
    private chatId: string;
    private enabled: boolean;
    private apiBaseUrl: string;

    private constructor(config: TelegramConfig) {
        this.botToken = config.botToken;
        this.chatId = config.chatId;
        this.enabled = config.enabled;
        this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;

        if (this.enabled) {
            logger.info('TelegramService', '📱 Telegram notifications enabled');
        } else {
            logger.info('TelegramService', '📵 Telegram notifications disabled');
        }
    }

    public static getInstance(config?: TelegramConfig): TelegramService {
        if (!TelegramService.instance) {
            if (!config) {
                // Create disabled instance if no config provided
                config = { botToken: '', chatId: '', enabled: false };
            }
            TelegramService.instance = new TelegramService(config);
        }
        return TelegramService.instance;
    }

    public static resetInstance(): void {
        TelegramService.instance = null;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Send a raw text message to Telegram
     */
    public async sendMessage(text: string): Promise<boolean> {
        if (!this.enabled) {
            logger.debug('TelegramService', 'Telegram disabled, skipping message');
            return false;
        }

        if (!this.botToken || !this.chatId) {
            logger.warn('TelegramService', 'Missing bot token or chat ID');
            return false;
        }

        try {
            const response = await axios.post(`${this.apiBaseUrl}/sendMessage`, {
                chat_id: this.chatId,
                text: text,
                parse_mode: 'HTML'
            }, {
                timeout: 10000
            });

            if (response.data.ok) {
                logger.debug('TelegramService', 'Message sent successfully');
                return true;
            } else {
                logger.error('TelegramService', 'Telegram API error', response.data);
                return false;
            }
        } catch (error: any) {
            logger.error('TelegramService', 'Failed to send Telegram message', error.message);
            return false;
        }
    }

    /**
     * Format and send trade entry notification
     */
    public async notifyTradeEntry(data: TradeEntryNotification): Promise<boolean> {
        const emoji = data.type === 'LONG' ? '📈' : '📉';
        const typeText = data.type === 'LONG' ? 'LONG' : 'SHORT';

        const message = `
🔔 <b>ОТКРЫТА ПОЗИЦИЯ</b>
━━━━━━━━━━━━━━━━
📊 Пара: <b>${data.symbol}</b>
${emoji} Тип: <b>${typeText}</b>
💰 Размер: <b>$${this.formatNumber(data.size)}</b>
💵 Цена входа: <b>$${this.formatNumber(data.entryPrice)}</b>
🎯 Take Profit: <b>$${this.formatNumber(data.takeProfit)}</b>
🛡️ Stop Loss: <b>$${this.formatNumber(data.stopLoss)}</b>
💼 Баланс: <b>$${this.formatNumber(data.balance)}</b>
`.trim();

        return this.sendMessage(message);
    }

    /**
     * Format and send trade exit notification
     */
    public async notifyTradeExit(data: TradeExitNotification): Promise<boolean> {
        const emoji = data.type === 'LONG' ? '📈' : '📉';
        const typeText = data.type === 'LONG' ? 'LONG' : 'SHORT';
        const pnlEmoji = data.pnl >= 0 ? '✅' : '❌';
        const pnlSign = data.pnl >= 0 ? '+' : '';

        // Map exit reasons to Russian
        const reasonMap: Record<string, string> = {
            'TP': 'Take Profit',
            'TAKE_PROFIT': 'Take Profit',
            'SL': 'Stop Loss',
            'STOP_LOSS': 'Stop Loss',
            'TRAILING': 'Trailing Stop',
            'MANUAL': 'Ручное закрытие',
            'REGIME_CHANGE': 'Смена режима',
            'EXPIRED': 'Истек срок'
        };
        const reasonText = reasonMap[data.reason] || data.reason;

        const message = `
${pnlEmoji} <b>ЗАКРЫТА ПОЗИЦИЯ</b>
━━━━━━━━━━━━━━━━
📊 Пара: <b>${data.symbol}</b>
${emoji} Тип: <b>${typeText}</b>
💵 Цена выхода: <b>$${this.formatNumber(data.exitPrice)}</b>
📊 PnL: <b>${pnlSign}$${this.formatNumber(data.pnl)} (${pnlSign}${data.pnlPercent.toFixed(2)}%)</b>
💸 Комиссия: <b>$${this.formatNumber(data.commission)}</b>
🏷️ Причина: <b>${reasonText}</b>
💼 Баланс: <b>$${this.formatNumber(data.balance)}</b>
`.trim();

        return this.sendMessage(message);
    }

    /**
     * Send a test message to verify connectivity
     */
    public async sendTestMessage(): Promise<boolean> {
        const message = `
🤖 <b>Telegram Bot Test</b>
━━━━━━━━━━━━━━━━
✅ Подключение успешно!
📅 ${new Date().toISOString()}
`.trim();

        return this.sendMessage(message);
    }

    private formatNumber(num: number): string {
        if (num >= 1000) {
            return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return num.toFixed(num < 1 ? 6 : 2);
    }
}

// Export singleton getter
export const telegram = (config?: TelegramConfig): TelegramService => TelegramService.getInstance(config);
