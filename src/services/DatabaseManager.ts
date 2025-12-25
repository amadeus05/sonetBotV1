/**
 * Database Manager
 * Single Responsibility: Manage all database operations
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { Position, TradeResult, BacktestResult, PositionStatus } from '../types';
import { logger } from './Logger';

export class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Database.Database;

  private constructor() {
    const dbPath = process.env.DB_PATH || './data/trading.db';
    const dbDir = path.dirname(dbPath);

    // Ensure directory exists
    const fs = require('fs');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeTables();
    logger.info('Database', 'Initialized successfully');
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private initializeTables(): void {
    // Positions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        id TEXT PRIMARY KEY,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry REAL NOT NULL,
        size REAL NOT NULL,
        leverage INTEGER NOT NULL,
        stopLoss REAL NOT NULL,
        takeProfit REAL NOT NULL,
        openTime INTEGER NOT NULL,
        closeTime INTEGER,
        closePrice REAL,
        pnl REAL,
        pnlPercent REAL,
        status TEXT NOT NULL,
        exitReason TEXT,
        tags TEXT,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Trades table (completed trades with full analysis)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        positionId TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry REAL NOT NULL,
        exit REAL NOT NULL,
        size REAL NOT NULL,
        pnl REAL NOT NULL,
        pnlPercent REAL NOT NULL,
        won INTEGER NOT NULL,
        rr REAL NOT NULL,
        holdTime INTEGER NOT NULL,
        exitReason TEXT NOT NULL,
        tags TEXT,
        openTime INTEGER NOT NULL,
        closeTime INTEGER NOT NULL,
        createdAt INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (positionId) REFERENCES positions(id)
      )
    `);

    // Signals table (all generated signals, even if not traded)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        type TEXT NOT NULL,
        entry REAL NOT NULL,
        stopLoss REAL NOT NULL,
        takeProfit REAL NOT NULL,
        confidence REAL NOT NULL,
        positionSize REAL NOT NULL,
        tags TEXT,
        metadata TEXT,
        traded INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Backtest results table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        startDate INTEGER NOT NULL,
        endDate INTEGER NOT NULL,
        symbols TEXT NOT NULL,
        initialBalance REAL NOT NULL,
        finalBalance REAL NOT NULL,
        totalTrades INTEGER NOT NULL,
        winRate REAL NOT NULL,
        profitFactor REAL NOT NULL,
        maxDrawdown REAL NOT NULL,
        sharpeRatio REAL NOT NULL,
        config TEXT NOT NULL,
        equityCurve TEXT NOT NULL,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Performance metrics table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        totalTrades INTEGER NOT NULL,
        winningTrades INTEGER NOT NULL,
        losingTrades INTEGER NOT NULL,
        winRate REAL NOT NULL,
        pnl REAL NOT NULL,
        balance REAL NOT NULL,
        drawdown REAL NOT NULL,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Historical candles cache table for backtest
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS historical_candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume REAL NOT NULL,
        UNIQUE(symbol, timeframe, timestamp)
      )
    `);

    // Create indexes for better query performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
      CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_trades_openTime ON trades(openTime);
      CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
      CREATE INDEX IF NOT EXISTS idx_candles_lookup ON historical_candles(symbol, timeframe, timestamp);
    `);
  }

  // ============================================
  // POSITION OPERATIONS
  // ============================================

  public savePosition(position: Position): void {
    const stmt = this.db.prepare(`
      INSERT INTO positions (
        id, symbol, side, entry, size, leverage, stopLoss, takeProfit,
        openTime, closeTime, closePrice, pnl, pnlPercent, status, exitReason, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      position.id,
      position.symbol,
      position.side,
      position.entry,
      position.size,
      position.leverage,
      position.stopLoss,
      position.takeProfit,
      position.openTime,
      position.closeTime || null,
      position.closePrice || null,
      position.pnl || null,
      position.pnlPercent || null,
      position.status,
      position.exitReason || null,
      JSON.stringify(position.tags)
    );
  }

  public updatePosition(position: Position): void {
    const stmt = this.db.prepare(`
      UPDATE positions
      SET closeTime = ?, closePrice = ?, pnl = ?, pnlPercent = ?,
          status = ?, exitReason = ?
      WHERE id = ?
    `);

    stmt.run(
      position.closeTime || null,
      position.closePrice || null,
      position.pnl || null,
      position.pnlPercent || null,
      position.status,
      position.exitReason || null,
      position.id
    );
  }

  public getOpenPositions(): Position[] {
    const stmt = this.db.prepare(`
      SELECT * FROM positions WHERE status = 'OPEN' ORDER BY openTime DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(this.rowToPosition);
  }

  public getPosition(id: string): Position | null {
    const stmt = this.db.prepare('SELECT * FROM positions WHERE id = ?');
    const row = stmt.get(id) as any;
    return row ? this.rowToPosition(row) : null;
  }

  private rowToPosition(row: any): Position {
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      entry: row.entry,
      size: row.size,
      leverage: row.leverage,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      openTime: row.openTime,
      closeTime: row.closeTime,
      closePrice: row.closePrice,
      pnl: row.pnl,
      pnlPercent: row.pnlPercent,
      status: row.status,
      exitReason: row.exitReason,
      tags: JSON.parse(row.tags || '[]')
    };
  }

  // ============================================
  // TRADE OPERATIONS
  // ============================================

  public saveTrade(trade: TradeResult): void {
    const stmt = this.db.prepare(`
      INSERT INTO trades (
        positionId, symbol, side, entry, exit, size, pnl, pnlPercent,
        won, rr, holdTime, exitReason, tags, openTime, closeTime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trade.position.id,
      trade.position.symbol,
      trade.position.side,
      trade.position.entry,
      trade.position.closePrice!,
      trade.position.size,
      trade.position.pnl!,
      trade.position.pnlPercent!,
      trade.won ? 1 : 0,
      trade.rr,
      trade.holdTime,
      trade.position.exitReason!,
      JSON.stringify(trade.position.tags),
      trade.position.openTime,
      trade.position.closeTime!
    );
  }

  public getTrades(limit: number = 100): TradeResult[] {
    const stmt = this.db.prepare(`
      SELECT * FROM trades ORDER BY closeTime DESC LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(this.rowToTrade);
  }

  public getTradesBySymbol(symbol: string, limit: number = 100): TradeResult[] {
    const stmt = this.db.prepare(`
      SELECT * FROM trades WHERE symbol = ? ORDER BY closeTime DESC LIMIT ?
    `);

    const rows = stmt.all(symbol, limit) as any[];
    return rows.map(this.rowToTrade);
  }

  private rowToTrade(row: any): TradeResult {
    return {
      position: {
        id: row.positionId,
        symbol: row.symbol,
        side: row.side,
        entry: row.entry,
        size: row.size,
        leverage: 1, // Not stored in trades table
        stopLoss: 0, // Not stored in trades table
        takeProfit: 0, // Not stored in trades table
        openTime: row.openTime,
        closeTime: row.closeTime,
        closePrice: row.exit,
        pnl: row.pnl,
        pnlPercent: row.pnlPercent,
        status: PositionStatus.CLOSED,
        exitReason: row.exitReason,
        tags: JSON.parse(row.tags || '[]')
      },
      won: row.won === 1,
      rr: row.rr,
      holdTime: row.holdTime,
      slippage: 0
    };
  }

  // ============================================
  // STATISTICS
  // ============================================

  public getPerformanceStats(days: number = 30): any {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(*) as totalTrades,
        SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) as losses,
        AVG(CASE WHEN won = 1 THEN pnl END) as avgWin,
        AVG(CASE WHEN won = 0 THEN pnl END) as avgLoss,
        AVG(rr) as avgRR,
        SUM(pnl) as totalPnL
      FROM trades
      WHERE closeTime > ?
    `);

    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const result = stmt.get(cutoffTime) as any;

    return {
      totalTrades: result.totalTrades || 0,
      wins: result.wins || 0,
      losses: result.losses || 0,
      winRate: result.totalTrades > 0 ? (result.wins / result.totalTrades) * 100 : 0,
      avgWin: result.avgWin || 0,
      avgLoss: Math.abs(result.avgLoss || 0),
      avgRR: result.avgRR || 0,
      totalPnL: result.totalPnL || 0
    };
  }

  // ============================================
  // HISTORICAL CANDLES CACHE
  // ============================================

  /**
   * Save candles to local cache (INSERT OR IGNORE to avoid duplicates)
   */
  public saveCandles(symbol: string, timeframe: string, candles: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]): void {
    if (candles.length === 0) return;

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO historical_candles (symbol, timeframe, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: typeof candles) => {
      for (const c of items) {
        insert.run(symbol, timeframe, c.timestamp, c.open, c.high, c.low, c.close, c.volume);
      }
    });

    insertMany(candles);
    logger.info('Database', `Cached ${candles.length} candles for ${symbol}`);
  }

  /**
   * Get candles from local cache
   */
  public getCandles(symbol: string, timeframe: string, startTime: number, endTime: number): { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[] {
    const stmt = this.db.prepare(`
      SELECT timestamp, open, high, low, close, volume
      FROM historical_candles
      WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(symbol, timeframe, startTime, endTime) as any[];
    return rows.map(r => ({
      timestamp: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume
    }));
  }

  /**
   * Check if we have enough cached data for the given range
   * Returns true if we have at least 80% of expected candles
   */
  public hasDataForRange(symbol: string, timeframe: string, startTime: number, endTime: number): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM historical_candles
      WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
    `);

    const result = stmt.get(symbol, timeframe, startTime, endTime) as { count: number };

    // Calculate expected candle count based on timeframe
    const timeframeMs = timeframe === '15m' ? 15 * 60 * 1000 : 5 * 60 * 1000;
    const expectedCount = Math.floor((endTime - startTime) / timeframeMs);

    // Require at least 80% of expected candles to use cache
    return result.count >= expectedCount * 0.8;
  }

  public close(): void {
    this.db.close();
  }
}

// Export singleton
export const db = DatabaseManager.getInstance();