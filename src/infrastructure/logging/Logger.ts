/**
 * Logger Service
 * Single Responsibility: Handle all logging with consistent format
 */

import * as fs from 'fs';
import * as path from 'path';
import { LogLevel, LogEntry } from '../../types';

export class Logger {
  private static instance: Logger;
  private logPath: string;
  private logLevel: LogLevel;
  private logToFile: boolean;

  private constructor() {
    this.logPath = process.env.LOG_PATH || './logs';
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'info');
    this.logToFile = true;
    this.ensureLogDirectory();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private parseLogLevel(level: string): LogLevel {
    const upperLevel = level.toUpperCase();
    return LogLevel[upperLevel as keyof typeof LogLevel] || LogLevel.INFO;
  }

  private ensureLogDirectory(): void {
    if (this.logToFile && !fs.existsSync(this.logPath)) {
      fs.mkdirSync(this.logPath, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private formatMessage(entry: LogEntry): string {
    const date = new Date(entry.timestamp).toISOString();
    const dataStr = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
    return `[${date}] [${entry.level}] [${entry.context}] ${entry.message}${dataStr}`;
  }

  private writeToFile(message: string): void {
    if (!this.logToFile) return;

    const date = new Date().toISOString().split('T')[0];
    const filename = `trading-${date}.log`;
    const filepath = path.join(this.logPath, filename);

    fs.appendFileSync(filepath, message + '\n');
  }

  private log(level: LogLevel, context: string, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      context,
      message,
      data
    };

    const formatted = this.formatMessage(entry);

    // Console output with colors
    switch (level) {
      case LogLevel.DEBUG:
        console.log(`\x1b[36m${formatted}\x1b[0m`); // Cyan
        break;
      case LogLevel.INFO:
        console.log(`\x1b[37m${formatted}\x1b[0m`); // White
        break;
      case LogLevel.WARN:
        console.log(`\x1b[33m${formatted}\x1b[0m`); // Yellow
        break;
      case LogLevel.ERROR:
        console.log(`\x1b[31m${formatted}\x1b[0m`); // Red
        break;
    }

    this.writeToFile(formatted);
  }

  public debug(context: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, context, message, data);
  }

  public info(context: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, context, message, data);
  }

  public warn(context: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, context, message, data);
  }

  public error(context: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, context, message, data);
  }

  public trade(symbol: string, message: string, data?: any): void {
    this.info('TRADE', `[${symbol}] ${message}`, data);
  }

  public signal(symbol: string, message: string, data?: any): void {
    this.info('SIGNAL', `[${symbol}] ${message}`, data);
  }

  public performance(message: string, data?: any): void {
    this.info('PERFORMANCE', message, data);
  }
}

// Export singleton
export const logger = Logger.getInstance();