/**
 * Скрипт валидации исторических свечей в SQLite (`historical_candles`) против Binance Futures API.
 *
 * Что делает:
 * - Берёт уникальные `symbol` по `timeframe` из БД
 * - Для каждой монеты берёт min/max timestamp и идёт от min до max батчами (limit свечей)
 * - Запрашивает свечи у Binance и сравнивает по timestamp + OHLCV (+ takerBuyBaseVolume)
 * - Пишет в консоль: пропуски в БД, отсутствие данных на Binance, расхождения полей
 *
 * Запуск:
 * - npm run validate-db
 *
 * Параметры:
 * - --db <path>                 путь до БД (по умолчанию: env DB_PATH или ./data/trading.db)
 * - --timeframe <15m>           таймфрейм (по умолчанию: env TIMEFRAME или 15m)
 * - --symbols <BTCUSDT,ETHUSDT> ограничить список монет
 * - --max-symbols <N>           ограничить количество монет
 * - --limit <N>                 лимит на запрос (по умолчанию 1000)
 * - --delay-ms <N>              задержка между REST запросами (по умолчанию 80мс)
 * - --max-issues <N>            остановиться после N проблем (по умолчанию 200)
 * - --include-live              НЕ пропускать “текущую” незакрытую свечу (по умолчанию пропускаем)
 */

import Database from 'better-sqlite3';
import { BinanceService } from '../infrastructure/exchanges/binance/BinanceService';
import { Helpers } from '../utils/Helpers';
import { Candle } from '../types';

type IssueType = 'MISSING_DB' | 'MISSING_BINANCE' | 'MISMATCH';

interface Args {
  dbPath?: string;
  timeframe?: string;
  symbols?: string[];
  maxSymbols?: number;
  limit?: number;
  delayMs?: number;
  maxIssues?: number;
  includeLive?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');

    switch (key) {
      case 'db':
        if (hasValue) out.dbPath = next, i++;
        break;
      case 'timeframe':
        if (hasValue) out.timeframe = next, i++;
        break;
      case 'symbols':
        if (hasValue) out.symbols = next.split(',').map(s => s.trim()).filter(Boolean), i++;
        break;
      case 'max-symbols':
        if (hasValue) out.maxSymbols = parseInt(next, 10), i++;
        break;
      case 'limit':
        if (hasValue) out.limit = parseInt(next, 10), i++;
        break;
      case 'delay-ms':
        if (hasValue) out.delayMs = parseInt(next, 10), i++;
        break;
      case 'max-issues':
        if (hasValue) out.maxIssues = parseInt(next, 10), i++;
        break;
      case 'include-live':
        out.includeLive = true;
        break;
    }
  }
  return out;
}

function parseTimeframeMs(timeframe: string): number {
  const tf = (timeframe || '').trim();
  const match = tf.match(/^(\d+)([mhdw])$/i);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return 0;

  switch (unit) {
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    case 'w': return value * 7 * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

function almostEqual(a: number, b: number, rel = 1e-10, abs = 1e-12): boolean {
  const diff = Math.abs(a - b);
  if (diff <= abs) return true;
  return diff <= Math.max(Math.abs(a), Math.abs(b)) * rel;
}

function candleDiff(db: Candle, ex: Candle): string[] {
  const diffs: string[] = [];
  if (!almostEqual(db.open, ex.open)) diffs.push(`open db=${db.open} ex=${ex.open}`);
  if (!almostEqual(db.high, ex.high)) diffs.push(`high db=${db.high} ex=${ex.high}`);
  if (!almostEqual(db.low, ex.low)) diffs.push(`low db=${db.low} ex=${ex.low}`);
  if (!almostEqual(db.close, ex.close)) diffs.push(`close db=${db.close} ex=${ex.close}`);
  if (!almostEqual(db.volume, ex.volume)) diffs.push(`volume db=${db.volume} ex=${ex.volume}`);
  if (!almostEqual(db.takerBuyBaseVolume ?? 0, ex.takerBuyBaseVolume ?? 0)) {
    diffs.push(`takerBuyBaseVolume db=${db.takerBuyBaseVolume ?? 0} ex=${ex.takerBuyBaseVolume ?? 0}`);
  }
  return diffs;
}

function fmtTs(ts: number): string {
  return `${ts} (${Helpers.formatDate(ts)})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const timeframe = args.timeframe || process.env.TIMEFRAME || '15m';
  const tfMs = parseTimeframeMs(timeframe);
  if (!tfMs) {
    console.error(`❌ Неверный timeframe: "${timeframe}" (пример: 15m, 1h)`);
    process.exit(2);
  }

  const dbPath = args.dbPath || process.env.DB_PATH || './data/trading.db';
  const limit = Number.isFinite(args.limit) && (args.limit as number) > 0 ? (args.limit as number) : 1000;
  const delayMs = Number.isFinite(args.delayMs) && (args.delayMs as number) >= 0 ? (args.delayMs as number) : 80;
  const maxIssues = Number.isFinite(args.maxIssues) && (args.maxIssues as number) > 0 ? (args.maxIssues as number) : 200;
  const includeLive = args.includeLive === true;

  console.log(`🗄️ DB: ${dbPath}`);
  console.log(`⏱️ Таймфрейм: ${timeframe} (${tfMs} ms)`);
  console.log(`📦 Binance limit: ${limit}, задержка: ${delayMs}ms, max issues: ${maxIssues}`);

  const db = new Database(dbPath, { readonly: true });

  const table = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='historical_candles'`
  ).get() as { name?: string } | undefined;
  if (!table?.name) {
    console.error('❌ Таблица historical_candles не найдена в этой БД.');
    process.exit(2);
  }

  const symbols: string[] = args.symbols && args.symbols.length
    ? args.symbols
    : (db.prepare(
      `SELECT DISTINCT symbol FROM historical_candles WHERE timeframe = ? ORDER BY symbol`
    ).all(timeframe) as any[]).map(r => r.symbol);

  const maxSymbols = args.maxSymbols && args.maxSymbols > 0 ? args.maxSymbols : undefined;
  const symbolsToCheck = maxSymbols ? symbols.slice(0, maxSymbols) : symbols;

  console.log(`🪙 Монет в проверке: ${symbolsToCheck.length}${symbolsToCheck.length !== symbols.length ? ` (из ${symbols.length})` : ''}`);

  const getRangeStmt = db.prepare(
    `SELECT MIN(timestamp) as minTs, MAX(timestamp) as maxTs, COUNT(*) as cnt
     FROM historical_candles
     WHERE symbol = ? AND timeframe = ?`
  );

  const getDbCandlesStmt = db.prepare(
    `SELECT timestamp, open, high, low, close, volume, takerBuyBaseVolume, openInterest
     FROM historical_candles
     WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
     ORDER BY timestamp ASC`
  );

  const binance = new BinanceService();

  let issues = 0;
  const issuesByType: Record<IssueType, number> = {
    MISSING_DB: 0,
    MISSING_BINANCE: 0,
    MISMATCH: 0
  };

  for (const symbol of symbolsToCheck) {
    const range = getRangeStmt.get(symbol, timeframe) as any;
    const minTs = Number(range?.minTs);
    const maxTsRaw = Number(range?.maxTs);
    const cnt = Number(range?.cnt);

    if (!Number.isFinite(minTs) || !Number.isFinite(maxTsRaw) || cnt <= 0) {
      console.log(`⚠️ ${symbol}: нет данных в БД для timeframe=${timeframe}`);
      continue;
    }

    let maxTs = maxTsRaw;
    const now = Date.now();
    const isLiveCandle = maxTs > (now - tfMs); // последняя свеча может быть незакрытая
    if (isLiveCandle && !includeLive) {
      maxTs = maxTs - tfMs;
    }

    console.log(`\n=== ${symbol} ===`);
    console.log(`📊 Свечей в БД: ${cnt}, диапазон: ${fmtTs(minTs)} -> ${fmtTs(maxTs)}${isLiveCandle ? (includeLive ? ' (включая текущую)' : ' (текущая пропущена)') : ''}`);

    if (minTs % tfMs !== 0) {
      console.log(`⚠️ ${symbol}: minTs не кратен таймфрейму (${minTs} % ${tfMs} != 0). Возможно, смещение данных.`);
    }

    if (maxTs < minTs) {
      console.log(`⚠️ ${symbol}: некорректный диапазон (maxTs < minTs)`);
      continue;
    }

    // Батчим по "limit" свечей: [start .. start + (limit-1)*tfMs]
    for (let batchStart = minTs; batchStart <= maxTs; batchStart += tfMs * limit) {
      const batchEnd = Math.min(batchStart + tfMs * (limit - 1), maxTs);

      // 1) DB свечи
      const dbRows = getDbCandlesStmt.all(symbol, timeframe, batchStart, batchEnd) as any[];
      const dbMap = new Map<number, Candle>();
      for (const r of dbRows) {
        dbMap.set(r.timestamp, {
          timestamp: r.timestamp,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volume,
          takerBuyBaseVolume: r.takerBuyBaseVolume ?? 0,
          openInterest: r.openInterest ?? 0
        });
      }

      // 2) Binance свечи
      let exCandles: Candle[] = [];
      try {
        exCandles = await Helpers.retry(
          () => binance.getCandles(symbol, timeframe, limit, batchStart, batchEnd),
          3,
          500
        );
      } catch (e: any) {
        console.log(`❌ ${symbol}: ошибка запроса Binance на диапазоне ${fmtTs(batchStart)} -> ${fmtTs(batchEnd)}: ${e?.message || e}`);
        issues++;
        if (issues >= maxIssues) break;
        await Helpers.sleep(delayMs);
        continue;
      }

      // Binance иногда может отдать свечи вне границ — фильтруем по факту.
      exCandles = exCandles.filter(c => c.timestamp >= batchStart && c.timestamp <= batchEnd);
      const exMap = new Map<number, Candle>(exCandles.map(c => [c.timestamp, c]));

      // 3) Сверка по ожидаемым timestamp
      for (let ts = batchStart; ts <= batchEnd; ts += tfMs) {
        const dbC = dbMap.get(ts);
        const exC = exMap.get(ts);

        if (!dbC && exC) {
          issues++;
          issuesByType.MISSING_DB++;
          console.log(`🟠 [${symbol}] ПРОПУСК В БД: ts=${fmtTs(ts)}`);
        } else if (dbC && !exC) {
          issues++;
          issuesByType.MISSING_BINANCE++;
          console.log(`🟡 [${symbol}] НЕТ НА BINANCE: ts=${fmtTs(ts)} (в БД есть свеча)`);
        } else if (dbC && exC) {
          const diffs = candleDiff(dbC, exC);
          if (diffs.length) {
            issues++;
            issuesByType.MISMATCH++;
            console.log(`🔴 [${symbol}] РАСХОЖДЕНИЕ: ts=${fmtTs(ts)} | ${diffs.join(' | ')}`);
          }
        } else {
          // !dbC && !exC - нечего сравнивать, но это странно: ожидаемый ts отсутствует и там и там
          issues++;
          issuesByType.MISSING_DB++;
          issuesByType.MISSING_BINANCE++;
          console.log(`⚪ [${symbol}] НЕТ И В БД И НА BINANCE: ts=${fmtTs(ts)}`);
        }

        if (issues >= maxIssues) break;
      }

      if (issues >= maxIssues) {
        console.log(`⛔ Остановка: достигнут лимит проблем (${maxIssues}).`);
        break;
      }

      await Helpers.sleep(delayMs);
    }

    if (issues >= maxIssues) break;
  }

  console.log('\n=== ИТОГ ===');
  console.log(`Проблем всего: ${issues}`);
  console.log(`- Пропуски в БД: ${issuesByType.MISSING_DB}`);
  console.log(`- Нет на Binance: ${issuesByType.MISSING_BINANCE}`);
  console.log(`- Расхождения OHLCV: ${issuesByType.MISMATCH}`);
}

main().catch((e) => {
  console.error('❌ Фатальная ошибка:', e);
  process.exit(1);
});


