Секрет простой:
1. ✅ ОДИН четкий edge (преимущество)
2. ✅ Строгие правила входа/выхода
3. ✅ Идеальное исполнение (без эмоций)
4. ✅ Консервативный R:R (1:2, не 1:10)
5. ✅ Малое количество качественных сделок
```

---

## 🎲 Какую стратегию выбрать?

Предлагаю **3 варианта** (выбери один, или я выберу лучший):

### **Вариант 1: "Momentum Breakout with Pullback"** ⭐ (МОЙ ВЫБОР)
```
Логика:
1. Определяем тренд (EMA 50/200)
2. Ждем импульсное движение (momentum spike)
3. Ждем откат к EMA (pullback)
4. Входим на отбое с подтверждением объема

Почему работает:
- Торгуем ПО тренду (60% винрейта)
- Входим на коррекции (лучшая цена)
- Подтверждение объемом (институции с нами)
- Tight SL (знаем где неправы)

Expected винрейт: 45-50%
R:R: 1:2.5
Сделок в день: 1-3
```

**Преимущества:**
- ✅ Проверенная логика (работает 20+ лет)
- ✅ Простая для кодирования
- ✅ Четкие точки входа/выхода
- ✅ Хорошо бэктестится

---

### **Вариант 2: "Order Flow Imbalance"** 🔥
```
Логика:
1. Мониторим CVD (Cumulative Volume Delta)
2. Ищем расхождения: цена вверх, CVD вниз
3. Ждем подтверждения OI (Open Interest)
4. Входим на развороте с tight SL

Почему работает:
- Видим реальных покупателей/продавцов
- Ловим "умных денег"
- Divergences = high probability

Expected винрейт: 42-48%
R:R: 1:2-1:3
Сделок в день: 2-4
```

**Преимущества:**
- ✅ У тебя уже есть эти данные!
- ✅ Orderflow + CVD + OI
- ✅ Работает на крипте отлично

**Недостатки:**
- ⚠️ Сложнее настроить
- ⚠️ Нужна тонкая калибровка

---

### **Вариант 3: "Mean Reversion + Regime Filter"** 📊
```
Логика:
1. Определяем режим: trending/ranging
2. В ranging: торгуем отбои от границ
3. Только при подтверждении всех модулей
4. Быстрый вход/выход

Почему работает:
- 70% времени рынок в range
- Высокий винрейт (55%+)
- Но маленький R:R (1:1.5)

Expected винрейт: 52-58%
R:R: 1:1.5-1:2
Сделок в день: 3-5


🎯 Мой выбор: Вариант 1 + элементы Варианта 2
"Trend-Following Momentum with Order Flow Confirmation"
javascriptГибридная стратегия:

1️⃣ Фильтр тренда (базовый)
   - EMA 50/200 для направления
   - Торгуем только по тренду

2️⃣ Momentum сигнал (триггер)
   - RSI extreme (>70 или <30)
   - Volume spike (>1.5x average)
   - Резкое движение цены

3️⃣ Pullback (точка входа)
   - Откат к EMA или key level
   - Не гонимся за ценой!

4️⃣ Order Flow подтверждение (фильтр качества)
   - CVD согласен с направлением
   - OI растет (интерес есть)
   - Liquidations на нашей стороне

5️⃣ Вход (исполнение)
   - Market order на сигнале
   - SL: под/над pullback level
   - TP: 2x или 2.5x SL

Expected результат:
✅ Винрейт: 43-48%
✅ R:R: 1:2.5
✅ Сделок: 10-15 в неделю
✅ Drawdown: <15%
```

---

## 📐 Архитектура бота
```
┌─────────────────────────────────────────┐
│         MARKET DATA FEED                │
│  (Price, Volume, OI, CVD, Liquidations) │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       REGIME DETECTOR                   │
│  • Trending / Ranging                   │
│  • BTC Sync Check                       │
│  • Volatility State                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       SIGNAL GENERATOR                  │
│  • Trend Filter (EMA)                   │
│  • Momentum Detector (RSI + Volume)     │
│  • Pullback Scanner                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       ORDER FLOW VALIDATOR              │
│  • CVD Alignment                        │
│  • OI Confirmation                      │
│  • Liquidation Check                    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       RISK MANAGER                      │
│  • Position Sizing (Kelly/Fixed %)     │
│  • SL/TP Calculator                     │
│  • Max Drawdown Check                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       EXECUTION ENGINE                  │
│  • Order Placement                      │
│  • Trade Tracking                       │
│  • Exit Management                      │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│       ANALYTICS & LOGGING               │
│  • Performance Metrics                  │
│  • Trade Journal                        │
│  • Equity Curve                         │
└─────────────────────────────────────────┘

🔧 Параметры стратегии (настраиваемые)
javascriptconst CONFIG = {
  // === RISK MANAGEMENT ===
  accountSize: 1000,           // Стартовый депозит
  riskPerTrade: 0.01,          // 1% риска на сделку
  maxOpenTrades: 2,            // Максимум открытых позиций
  leverage: 2,                 // Плечо (консервативно)
  
  // === TREND FILTER ===
  emaFast: 50,                 // Быстрая EMA
  emaSlow: 200,                // Медленная EMA
  minTrendStrength: 0.02,      // Минимум 2% между EMA
  
  // === MOMENTUM ===
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  volumeSpikeMultiplier: 1.5,  // Объем > 1.5x среднего
  
  // === PULLBACK ===
  pullbackToEMA: true,         // Ждать отката к EMA
  maxPullbackDistance: 0.03,   // Максимум 3% от EMA
  
  // === ORDER FLOW ===
  cvdThreshold: 0.5,           // CVD минимум 0.5
  oiChangeMin: 0.1,            // OI изменение минимум 10%
  checkLiquidations: true,     // Учитывать ликвидации
  
  // === ENTRY/EXIT ===
  stopLossATRMultiplier: 1.5,  // SL = 1.5 * ATR
  takeProfitRatio: 2.5,        // TP = 2.5 * SL (R:R 1:2.5)
  trailingStop: false,         // Без трейлинга (пока)
  
  // === FILTERS ===
  minVolume: 1000000,          // Минимальный объем в USD
  maxSpread: 0.001,            // Максимальный спред 0.1%
  tradingHours: 'all',         // Торговые часы
  btcSyncRequired: true,       // Требовать синхронизации с BTC
};

📝 Основная логика (псевдокод)
javascriptfunction analyzeMarket(symbol, candles, orderFlowData) {
  
  // 1. ОПРЕДЕЛЯЕМ РЕЖИМ
  const regime = detectRegime(candles);
  if (regime !== 'TRENDING') return null; // Торгуем только тренд
  
  // 2. ОПРЕДЕЛЯЕМ ТРЕНД
  const trend = calculateTrend(candles);
  if (!trend.isStrong) return null; // Слабый тренд = skip
  
  // 3. ИЩЕМ MOMENTUM SPIKE
  const momentum = detectMomentum(candles);
  if (!momentum.hasSpike) return null;
  
  // 4. ПРОВЕРЯЕМ PULLBACK
  const pullback = checkPullback(candles, trend);
  if (!pullback.occurred) return null; // Еще не откатило
  
  // 5. ORDER FLOW ПОДТВЕРЖДЕНИЕ
  const orderFlow = validateOrderFlow(orderFlowData, trend.direction);
  if (!orderFlow.confirmed) return null; // Order flow против нас
  
  // 6. ФИНАЛЬНАЯ ПРОВЕРКА
  const btcSync = checkBTCSync();
  if (!btcSync && CONFIG.btcSyncRequired) return null;
  
  // 7. РАССЧИТЫВАЕМ ENTRY/SL/TP
  const entry = calculateEntry(candles, pullback);
  const stopLoss = calculateStopLoss(candles, entry, trend);
  const takeProfit = calculateTakeProfit(entry, stopLoss);
  
  // 8. РАЗМЕР ПОЗИЦИИ
  const positionSize = calculatePositionSize(
    CONFIG.accountSize,
    CONFIG.riskPerTrade,
    entry,
    stopLoss
  );
  
  // 9. ВОЗВРАЩАЕМ СИГНАЛ
  return {
    symbol,
    direction: trend.direction, // 'LONG' or 'SHORT'
    entry,
    stopLoss,
    takeProfit,
    positionSize,
    confidence: calculateConfidence(momentum, orderFlow, trend),
    tags: generateTags(momentum, pullback, orderFlow)
  };
}


Профессиональный Algo Trading Bot
✅ Что я создал:
Полнофункциональный бот с архитектурой enterprise-уровня:

🎯 Стратегия "Trend-Following Momentum"

EMA 50/200 для тренда
RSI + Volume для моментума
Pullback на EMA для входа
Order Flow подтверждение
Target: 40-50% винрейт, R:R 1:2-1:3


🏗️ Профессиональная архитектура

TypeScript + OOP + SOLID
Модульный дизайн
19 файлов чистого кода
Полное разделение ответственности


📊 Ключевые модули:

TradingBot - главный оркестратор
StrategyEngine - мозг бота
RiskManager - защита капитала
TradeExecutor - исполнение сделок
BacktestEngine - тестирование на истории
BinanceService - интеграция с биржей
DatabaseManager - SQLite хранилище


🛡️ Risk Management:

Kelly Criterion sizing
ATR-based stop losses
Daily loss limits (5%)
Max drawdown protection (15%)
Emergency stop система


📈 Функции:

✅ Live trading (testnet + production)
✅ Backtesting engine
✅ Real-time monitoring
✅ Trade logging & analytics
✅ Performance tracking
✅ CLI интерфейс




[2026-01-07T09:28:49.037Z] [INFO] [Database] Initialized successfully

╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║              🧪 BACKTEST MODE                            ║
║                                                           ║
║       Testing Strategy on Historical Data                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝


📋 Backtest Configuration:
   Period: 2025-01-13 to 2026-01-06
   Symbols: BNBUSDT, ETHUSDT, SOLUSDT, ZECUSDT, TAOUSDT
   Initial Balance: $100
   Risk per Trade: 1%
   Leverage: 3x

[2026-01-07T09:28:49.230Z] [INFO] [BinanceService] Initialized (https://testnet.binancefuture.com)
[2026-01-07T09:28:49.231Z] [INFO] [Backtest] 🧪 Starting V7.6 (Fixed & Complete) backtest... | {"symbols":"BNBUSDT, ETHUSDT, SOLUSDT, ZECUSDT, TAOUSDT","initialBalance":100}
[2026-01-07T09:28:49.231Z] [INFO] [Backtest] Position sizing mode: FIXED (realistic)
[2026-01-07T09:28:49.231Z] [INFO] [StrategyEngine] Initialized (Stateful Momentum Pullback v5.0 - Conservative)
[2026-01-07T09:28:49.232Z] [INFO] [Backtest] Fetching historical data (Klines + Open Interest)...
Fetching BNBUSDT... ✅ [DB] BNBUSDT: Using cache (103104 candles, coverage OK).
OK (103104 candles) [No OI Data]
Fetching ETHUSDT... ✅ [DB] ETHUSDT: Using cache (103104 candles, coverage OK).
OK (103104 candles) [No OI Data]
Fetching SOLUSDT... ✅ [DB] SOLUSDT: Using cache (103104 candles, coverage OK).
OK (103104 candles) [No OI Data]
Fetching ZECUSDT... ✅ [DB] ZECUSDT: Using cache (103104 candles, coverage OK).
OK (103104 candles) [No OI Data]
Fetching TAOUSDT... ✅ [DB] TAOUSDT: Using cache (103104 candles, coverage OK).
OK (103104 candles) [No OI Data]

[2026-01-07T09:28:51.094Z] [INFO] [Backtest] Timeline Steps: 103104
[0.0%] Eq: $100 | Free: $100 | Pos: 0
📅 Day Finished: 2025-01-13 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:51.097Z] [INFO] [STRATEGY] BNBUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:28:51.098Z] [INFO] [STRATEGY] ETHUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:28:51.098Z] [INFO] [STRATEGY] SOLUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:28:51.099Z] [INFO] [STRATEGY] ZECUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:28:51.099Z] [INFO] [STRATEGY] TAOUSDT | 🆕 NEW SETUP CREATED (IDLE)

📅 Day Finished: 2025-01-14 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-15 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-16 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:51.300Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.86"}
[2026-01-07T09:28:51.345Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.14"}

📅 Day Finished: 2025-01-17 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:51.486Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"5.88"}
[2026-01-07T09:28:51.495Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.64"}
[2026-01-07T09:28:51.516Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars

📅 Day Finished: 2025-01-18 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:51.687Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"20.00"}

📅 Day Finished: 2025-01-19 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:51.697Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"20.00"}
[2026-01-07T09:28:51.713Z] [INFO] [STRATEGY] TAOUSDT | ⏱️ TIMEOUT after 50 bars
[1.9%] Eq: $100 | Free: $100 | Pos: 0  [2026-01-07T09:28:51.806Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.36"}

📅 Day Finished: 2025-01-20 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:51.829Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.99"}

📅 Day Finished: 2025-01-21 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-22 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:52.020Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"4.75"}
[2026-01-07T09:28:52.051Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"6.59"}
[2026-01-07T09:28:52.074Z] [INFO] [STRATEGY] ETHUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:28:52.081Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"20.00"}

📅 Day Finished: 2025-01-23 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:52.143Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.86"}
[2026-01-07T09:28:52.146Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.25"}

📅 Day Finished: 2025-01-24 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-25 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-26 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[3.9%] Eq: $100 | Free: $100 | Pos: 0  [2026-01-07T09:28:52.477Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"6.07"}

📅 Day Finished: 2025-01-27 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-28 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:52.660Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"4.41"}

📅 Day Finished: 2025-01-29 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:52.791Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"20.00"}
[2026-01-07T09:28:52.810Z] [INFO] [STRATEGY] TAOUSDT | ⏱️ TIMEOUT after 50 bars

📅 Day Finished: 2025-01-30 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-01-31 | PnL: +$0.00 (0.00%) | Eq: +$100.00

📅 Day Finished: 2025-02-01 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:53.126Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.41"}
[2026-01-07T09:28:53.149Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:28:53.167Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"6.46"}
[2026-01-07T09:28:53.199Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"10.79"}

📅 Day Finished: 2025-02-02 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:28:53.215Z] [INFO] [STRATEGY] BNBUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.30) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":626.87,"impulseLow":617,"impulseATR":2.1867396618409325,"impulseVolumeRatio":10.792520035618878,"barsSinceImpulse":35,"pullbackLow":617.397005782479,"pullbackHigh":620,"pullbackDepth":0.004216078460280156,"pullback":{"occurred":true,"distanceFromEMA":0.4216078460280156,"level":620,"isValid":true,"low":617.397005782479,"high":620}}
[2026-01-07T09:28:53.223Z] [INFO] [STRATEGY] BNBUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"BNBUSDT","type":"SHORT","entry":617.287668799387,"stopLoss":624.3734793236819,"takeProfit":607.417668799387,"positionSize":77.59816349919367,"confidence":0.45372483025604154,"timestamp":1767778133222,"tags":["momentum_pullback","vol:10.8"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":626.87,"impulseLow":617,"impulseATR":2.1867396618409325,"impulseVolumeRatio":10.792520035618878,"barsSinceImpulse":35,"pullbackLow":617.397005782479,"pullbackHigh":620,"pullbackDepth":0.004216078460280156,"pullback":{"occurred":true,"distanceFromEMA":0.4216078460280156,"level":620,"isValid":true,"low":617.397005782479,"high":620}}}

🔥 OPEN TRADE [2025-02-03 01:50:00] BNBUSDT SHORT @ 617.287668799387 (Conf: 0.45)

   ✅ Closed BNBUSDT SHORT | PnL: +$1.16 | ROI: 1.60% notional / 4.50% margin | Time: 5m | Reason: TP
[2026-01-07T09:28:53.228Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.26"}
[5.8%] Eq: $101 | Free: $101 | Pos: 0  [2026-01-07T09:28:53.277Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"20.00"}
[2026-01-07T09:28:53.305Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.50"}
[2026-01-07T09:28:53.324Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.28"}
[2026-01-07T09:28:53.334Z] [INFO] [STRATEGY] ETHUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:28:53.342Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.83"}
[2026-01-07T09:28:53.346Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"5.23"}
[2026-01-07T09:28:53.361Z] [INFO] [STRATEGY] ETHUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:28:53.365Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.36"}

📅 Day Finished: 2025-02-03 | PnL: +$1.16 (+1.16%) | Eq: +$101.16
[2026-01-07T09:28:53.485Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.24"}
Terminate batch job (Y/N)?
^C
C:\Users\amadeus\Desktop\fastVersion>npm run backtest

> fastversion@1.0.0 backtest
> ts-node src/backtest.ts

[2026-01-07T09:29:19.677Z] [INFO] [Database] Initialized successfully

╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║              🧪 BACKTEST MODE                            ║
║                                                           ║
║       Testing Strategy on Historical Data                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝


📋 Backtest Configuration:
   Period: 2025-01-13 to 2026-01-06
   Symbols: BNBUSDT, ETHUSDT, SOLUSDT, ZECUSDT, TAOUSDT
   Initial Balance: $100
   Risk per Trade: 1%
   Leverage: 3x

[2026-01-07T09:29:19.870Z] [INFO] [BinanceService] Initialized (https://testnet.binancefuture.com)
[2026-01-07T09:29:19.871Z] [INFO] [Backtest] 🧪 Starting V7.6 (Fixed & Complete) backtest... | {"symbols":"BNBUSDT, ETHUSDT, SOLUSDT, ZECUSDT, TAOUSDT","initialBalance":100}
[2026-01-07T09:29:19.871Z] [INFO] [Backtest] Position sizing mode: FIXED (realistic)
[2026-01-07T09:29:19.871Z] [INFO] [StrategyEngine] Initialized (Stateful Momentum Pullback v5.0 - Conservative)
[2026-01-07T09:29:19.872Z] [INFO] [Backtest] Fetching historical data (Klines + Open Interest)...
Fetching BNBUSDT... ✅ [DB] BNBUSDT: Using cache (102249 candles, coverage OK).
OK (102249 candles) [No OI Data]
Fetching ETHUSDT... ✅ [DB] ETHUSDT: Using cache (102249 candles, coverage OK).
OK (102249 candles) [No OI Data]
Fetching SOLUSDT... ✅ [DB] SOLUSDT: Using cache (102249 candles, coverage OK).
OK (102249 candles) [No OI Data]
Fetching ZECUSDT... ✅ [DB] ZECUSDT: Using cache (102249 candles, coverage OK).
OK (102249 candles) [No OI Data]
Fetching TAOUSDT... ✅ [DB] TAOUSDT: Using cache (102249 candles, coverage OK).
OK (102249 candles) [No OI Data]

[2026-01-07T09:29:21.752Z] [INFO] [Backtest] Timeline Steps: 102249
[0.0%] Eq: $100 | Free: $100 | Pos: 0
📅 Day Finished: 2025-01-13 | PnL: +$0.00 (0.00%) | Eq: +$100.00
[2026-01-07T09:29:21.754Z] [INFO] [STRATEGY] BNBUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:29:21.756Z] [INFO] [STRATEGY] ETHUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:29:21.756Z] [INFO] [STRATEGY] SOLUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:29:21.757Z] [INFO] [STRATEGY] ZECUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:29:21.758Z] [INFO] [STRATEGY] TAOUSDT | 🆕 NEW SETUP CREATED (IDLE)
[2026-01-07T09:29:21.782Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.77"}
[2026-01-07T09:29:21.784Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.74"}
[2026-01-07T09:29:21.785Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.18"}
[2026-01-07T09:29:21.786Z] [INFO] [STRATEGY] BNBUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.62) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":692.34,"impulseLow":688.91,"impulseATR":0.7217169021395523,"impulseVolumeRatio":2.1820439274375616,"barsSinceImpulse":4,"pullbackLow":690.21,"pullbackHigh":690.4093011151285,"pullbackDepth":0.0002886709591058327,"pullback":{"occurred":true,"distanceFromEMA":0.02886709591058327,"level":690.21,"isValid":true,"low":690.21,"high":690.4093011151285}}
[2026-01-07T09:29:21.787Z] [INFO] [STRATEGY] BNBUSDT | ❌ RISK REJECTED: Margin commitment limit reached.
[2026-01-07T09:29:21.788Z] [INFO] [STRATEGY] ETHUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.65) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":3192.73,"impulseLow":3168.02,"impulseATR":6.8652228329730995,"impulseVolumeRatio":2.7677293369817497,"barsSinceImpulse":14,"pullbackLow":3176.59,"pullbackHigh":3180.8073914742936,"pullbackDepth":0.001325887095709586,"pullback":{"occurred":true,"distanceFromEMA":0.1325887095709586,"level":3176.59,"isValid":true,"low":3176.59,"high":3180.8073914742936}}
[2026-01-07T09:29:21.789Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.70"}
[2026-01-07T09:29:21.789Z] [INFO] [STRATEGY] ETHUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ETHUSDT","type":"LONG","entry":3181.1506526159424,"stopLoss":3162.859554334054,"takeProfit":3205.8606526159424,"positionSize":163.88719302091596,"confidence":0.711623374742303,"timestamp":1767778161789,"tags":["momentum_pullback","vol:2.8"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":3192.73,"impulseLow":3168.02,"impulseATR":6.8652228329730995,"impulseVolumeRatio":2.7677293369817497,"barsSinceImpulse":14,"pullbackLow":3176.59,"pullbackHigh":3180.8073914742936,"pullbackDepth":0.001325887095709586,"pullback":{"occurred":true,"distanceFromEMA":0.1325887095709586,"level":3176.59,"isValid":true,"low":3176.59,"high":3180.8073914742936}}}

🔥 OPEN TRADE [2025-01-14 09:35:00] ETHUSDT LONG @ 3181.1506526159424 (Conf: 0.71)
[2026-01-07T09:29:21.790Z] [INFO] [STRATEGY] SOLUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.49) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":187.36,"impulseLow":185.24,"impulseATR":0.482086920148524,"impulseVolumeRatio":1.7439826903210587,"barsSinceImpulse":10,"pullbackLow":186.33,"pullbackHigh":186.36822183382316,"pullbackDepth":0.00020508772068032478,"pullback":{"occurred":true,"distanceFromEMA":0.020508772068032477,"level":186.33,"isValid":true,"low":186.33,"high":186.36822183382316}}

   ✅ Closed ETHUSDT LONG | PnL: +$1.11 | ROI: 0.78% notional / 2.03% margin | Time: 5m | Reason: TP
[2026-01-07T09:29:21.791Z] [INFO] [STRATEGY] SOLUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"SOLUSDT","type":"LONG","entry":186.39232617983058,"stopLoss":185.36582615970298,"takeProfit":188.51232617983058,"positionSize":174.82474369501622,"confidence":0.813975086844418,"timestamp":1767778161791,"tags":["momentum_pullback","vol:1.7"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":187.36,"impulseLow":185.24,"impulseATR":0.482086920148524,"impulseVolumeRatio":1.7439826903210587,"barsSinceImpulse":10,"pullbackLow":186.33,"pullbackHigh":186.36822183382316,"pullbackDepth":0.00020508772068032478,"pullback":{"occurred":true,"distanceFromEMA":0.020508772068032477,"level":186.33,"isValid":true,"low":186.33,"high":186.36822183382316}}}

🔥 OPEN TRADE [2025-01-14 09:45:00] SOLUSDT LONG @ 186.39232617983058 (Conf: 0.81)

   ✅ Closed SOLUSDT LONG | PnL: +$1.81 | ROI: 1.14% notional / 3.11% margin | Time: 5m | Reason: TP
[2026-01-07T09:29:21.792Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.27"}
[2026-01-07T09:29:21.792Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.93"}
[2026-01-07T09:29:21.793Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.74"}
[2026-01-07T09:29:21.798Z] [INFO] [STRATEGY] ETHUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.59) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":3255.84,"impulseLow":3176.59,"impulseATR":10.701076596340032,"impulseVolumeRatio":2.2686449310695,"barsSinceImpulse":22,"pullbackLow":3208.82,"pullbackHigh":3211.7677175814656,"pullbackDepth":0.0009177866647483271,"pullback":{"occurred":true,"distanceFromEMA":0.09177866647483271,"level":3208.82,"isValid":true,"low":3208.82,"high":3211.7677175814656}}
[2026-01-07T09:29:21.801Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"7.05"}
[2026-01-07T09:29:21.801Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"6.16"}
[2026-01-07T09:29:21.803Z] [INFO] [STRATEGY] SOLUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.58) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":188.81,"impulseLow":185.53,"impulseATR":0.8826628244050223,"impulseVolumeRatio":6.15981574558368,"barsSinceImpulse":10,"pullbackLow":186.91,"pullbackHigh":187.16155843407125,"pullbackDepth":0.0013440710591211995,"pullback":{"occurred":true,"distanceFromEMA":0.13440710591211996,"level":186.91,"isValid":true,"low":186.91,"high":187.16155843407125}}
[2026-01-07T09:29:21.805Z] [INFO] [STRATEGY] SOLUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"SOLUSDT","type":"LONG","entry":187.2056915752915,"stopLoss":185.14467435118996,"takeProfit":190.4856915752915,"positionSize":87.97946681955223,"confidence":0.8429936866913904,"timestamp":1767778161805,"tags":["momentum_pullback","vol:6.2"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":188.81,"impulseLow":185.53,"impulseATR":0.8826628244050223,"impulseVolumeRatio":6.15981574558368,"barsSinceImpulse":10,"pullbackLow":186.91,"pullbackHigh":187.16155843407125,"pullbackDepth":0.0013440710591211995,"pullback":{"occurred":true,"distanceFromEMA":0.13440710591211996,"level":186.91,"isValid":true,"low":186.91,"high":187.16155843407125}}}

🔥 OPEN TRADE [2025-01-14 14:30:00] SOLUSDT LONG @ 187.2056915752915 (Conf: 0.84)
[2026-01-07T09:29:21.805Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.59"}
[2026-01-07T09:29:21.809Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.58) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":50.67,"impulseLow":49.33,"impulseATR":0.25854182767458755,"impulseVolumeRatio":1.5862384766798845,"barsSinceImpulse":22,"pullbackLow":49.89,"pullbackHigh":50.084718271687656,"pullbackDepth":0.0038877781168977347,"pullback":{"occurred":true,"distanceFromEMA":0.3887778116897735,"level":49.89,"isValid":true,"low":49.89,"high":50.084718271687656}}
[2026-01-07T09:29:21.809Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"LONG","entry":50.097645363071386,"stopLoss":49.372916344650825,"takeProfit":51.43764536307139,"positionSize":62.36792866131526,"confidence":0.5111748658108454,"timestamp":1767778161809,"tags":["momentum_pullback","vol:1.6"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":50.67,"impulseLow":49.33,"impulseATR":0.25854182767458755,"impulseVolumeRatio":1.5862384766798845,"barsSinceImpulse":22,"pullbackLow":49.89,"pullbackHigh":50.084718271687656,"pullbackDepth":0.0038877781168977347,"pullback":{"occurred":true,"distanceFromEMA":0.3887778116897735,"level":49.89,"isValid":true,"low":49.89,"high":50.084718271687656}}}

🔥 OPEN TRADE [2025-01-14 16:30:00] ZECUSDT LONG @ 50.097645363071386 (Conf: 0.51)

   ✅ Closed ZECUSDT LONG | PnL: +$1.61 | ROI: 2.67% notional / 7.72% margin | Time: 6.3h | Reason: TP

📅 Day Finished: 2025-01-14 | PnL: +$4.42 (+4.42%) | Eq: +$104.42

   ✅ Closed SOLUSDT LONG | PnL: +$1.45 | ROI: 1.75% notional / 4.95% margin | Time: 16.8h | Reason: TP
[2026-01-07T09:29:21.871Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.61"}
[2026-01-07T09:29:21.872Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.54"}
[2026-01-07T09:29:21.882Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.64"}
[2026-01-07T09:29:21.897Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:21.902Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.27"}

📅 Day Finished: 2025-01-15 | PnL: +$1.56 (+1.49%) | Eq: +$105.98
[2026-01-07T09:29:21.909Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.17"}

📅 Day Finished: 2025-01-16 | PnL: +$0.00 (0.00%) | Eq: +$105.98
[2026-01-07T09:29:22.051Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.97"}
[2026-01-07T09:29:22.059Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.20"}
[2026-01-07T09:29:22.076Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.56"}
[2026-01-07T09:29:22.095Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.97"}
[2026-01-07T09:29:22.097Z] [INFO] [STRATEGY] TAOUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.59) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":489.28,"impulseLow":475.51,"impulseATR":2.140392683818995,"impulseVolumeRatio":1.9680359868278798,"barsSinceImpulse":3,"pullbackLow":481.11,"pullbackHigh":481.21461578147716,"pullbackDepth":0.0002173994264643391,"pullback":{"occurred":true,"distanceFromEMA":0.02173994264643391,"level":481.11,"isValid":true,"low":481.11,"high":481.21461578147716}}
[2026-01-07T09:29:22.101Z] [INFO] [STRATEGY] TAOUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"TAOUSDT","type":"LONG","entry":481.32163541566814,"stopLoss":476.82921463236204,"takeProfit":495.0916354156681,"positionSize":99.86073672851485,"confidence":0.6602564284069119,"timestamp":1767778162101,"tags":["momentum_pullback","vol:2.0"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":489.28,"impulseLow":475.51,"impulseATR":2.140392683818995,"impulseVolumeRatio":1.9680359868278798,"barsSinceImpulse":3,"pullbackLow":481.11,"pullbackHigh":481.21461578147716,"pullbackDepth":0.0002173994264643391,"pullback":{"occurred":true,"distanceFromEMA":0.02173994264643391,"level":481.11,"isValid":true,"low":481.11,"high":481.21461578147716}}}

🔥 OPEN TRADE [2025-01-17 21:15:00] TAOUSDT LONG @ 481.32163541566814 (Conf: 0.66)

📅 Day Finished: 2025-01-17 | PnL: +$1.01 (+0.96%) | Eq: +$106.99

   ❌ Closed TAOUSDT LONG | PnL: -$1.05 | ROI: -0.95% notional / -3.16% margin | Time: 5.8h | Reason: SL
[2026-01-07T09:29:22.122Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.75"}
[2026-01-07T09:29:22.153Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:22.176Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.98"}
[2026-01-07T09:29:22.190Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.67"}
[2026-01-07T09:29:22.192Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.67) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":53.18,"impulseLow":51.56,"impulseATR":0.21364625533452725,"impulseVolumeRatio":1.6731674284435456,"barsSinceImpulse":3,"pullbackLow":52.39878742155654,"pullbackHigh":52.65,"pullbackDepth":0.0047942441190940615,"pullback":{"occurred":true,"distanceFromEMA":0.47942441190940616,"level":52.65,"isValid":true,"low":52.39878742155654,"high":52.65}}
[2026-01-07T09:29:22.193Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"SHORT","entry":52.388105108789816,"stopLoss":53.077292510669054,"takeProfit":50.76810510878982,"positionSize":67.96202490569675,"confidence":0.47034410520705255,"timestamp":1767778162193,"tags":["momentum_pullback","vol:1.7"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":53.18,"impulseLow":51.56,"impulseATR":0.21364625533452725,"impulseVolumeRatio":1.6731674284435456,"barsSinceImpulse":3,"pullbackLow":52.39878742155654,"pullbackHigh":52.65,"pullbackDepth":0.0047942441190940615,"pullback":{"occurred":true,"distanceFromEMA":0.47942441190940616,"level":52.65,"isValid":true,"low":52.39878742155654,"high":52.65}}}

🔥 OPEN TRADE [2025-01-18 15:25:00] ZECUSDT SHORT @ 52.388105108789816 (Conf: 0.47)

   ✅ Closed ZECUSDT SHORT | PnL: +$2.03 | ROI: 3.09% notional / 8.98% margin | Time: 45m | Reason: TP
[2026-01-07T09:29:22.199Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.74"}
[2026-01-07T09:29:22.215Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.42) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":52.4,"impulseLow":50.53,"impulseATR":0.40108530158585176,"impulseVolumeRatio":1.7354351640837598,"barsSinceImpulse":24,"pullbackLow":51.30675619370649,"pullbackHigh":51.31,"pullbackDepth":0.00006322376494168806,"pullback":{"occurred":true,"distanceFromEMA":0.006322376494168806,"level":51.31,"isValid":true,"low":51.30675619370649,"high":51.31}}
[2026-01-07T09:29:22.216Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"SHORT","entry":51.286701928627195,"stopLoss":52.112170603171705,"takeProfit":49.4167019286272,"positionSize":58.06820484752375,"confidence":0.6730909072073725,"timestamp":1767778162216,"tags":["momentum_pullback","vol:1.7"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":52.4,"impulseLow":50.53,"impulseATR":0.40108530158585176,"impulseVolumeRatio":1.7354351640837598,"barsSinceImpulse":24,"pullbackLow":51.30675619370649,"pullbackHigh":51.31,"pullbackDepth":0.00006322376494168806,"pullback":{"occurred":true,"distanceFromEMA":0.006322376494168806,"level":51.31,"isValid":true,"low":51.30675619370649,"high":51.31}}}

🔥 OPEN TRADE [2025-01-18 18:50:00] ZECUSDT SHORT @ 51.286701928627195 (Conf: 0.67)

   ❌ Closed ZECUSDT SHORT | PnL: -$1.00 | ROI: -1.63% notional / -5.19% margin | Time: 4.7h | Reason: SL

📅 Day Finished: 2025-01-18 | PnL: -$1.03 (-0.97%) | Eq: +$105.96
[2026-01-07T09:29:22.273Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.55"}
[2026-01-07T09:29:22.306Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.78"}
[2026-01-07T09:29:22.308Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.20"}

📅 Day Finished: 2025-01-19 | PnL: +$0.00 (0.00%) | Eq: +$105.96
[2.0%] Eq: $106 | Free: $106 | Pos: 0  [2026-01-07T09:29:22.469Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.56"}

📅 Day Finished: 2025-01-20 | PnL: +$0.00 (0.00%) | Eq: +$105.96
[2026-01-07T09:29:22.481Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.62"}

📅 Day Finished: 2025-01-21 | PnL: +$0.00 (0.00%) | Eq: +$105.96
[2026-01-07T09:29:22.581Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.23"}
[2026-01-07T09:29:22.618Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.19"}

📅 Day Finished: 2025-01-22 | PnL: +$0.00 (0.00%) | Eq: +$105.96
[2026-01-07T09:29:22.657Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.81"}
[2026-01-07T09:29:22.681Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.83"}
[2026-01-07T09:29:22.683Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.58"}
[2026-01-07T09:29:22.683Z] [INFO] [STRATEGY] ETHUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.66) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":3242.35,"impulseLow":3208.36,"impulseATR":7.578019080812768,"impulseVolumeRatio":1.8317346475515366,"barsSinceImpulse":3,"pullbackLow":3229.7076284306627,"pullbackHigh":3230.9,"pullbackDepth":0.0003691887026680468,"pullback":{"occurred":true,"distanceFromEMA":0.03691887026680468,"level":3230.9,"isValid":true,"low":3229.7076284306627,"high":3230.9}}
[2026-01-07T09:29:22.686Z] [INFO] [STRATEGY] ETHUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ETHUSDT","type":"SHORT","entry":3229.328727476622,"stopLoss":3246.0560381616256,"takeProfit":3195.3387274766224,"positionSize":175.96515251477143,"confidence":0.5573306780517323,"timestamp":1767778162686,"tags":["momentum_pullback","vol:1.8"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":3242.35,"impulseLow":3208.36,"impulseATR":7.578019080812768,"impulseVolumeRatio":1.8317346475515366,"barsSinceImpulse":3,"pullbackLow":3229.7076284306627,"pullbackHigh":3230.9,"pullbackDepth":0.0003691887026680468,"pullback":{"occurred":true,"distanceFromEMA":0.03691887026680468,"level":3230.9,"isValid":true,"low":3229.7076284306627,"high":3230.9}}}

🔥 OPEN TRADE [2025-01-23 04:55:00] ETHUSDT SHORT @ 3229.328727476622 (Conf: 0.56)

   ✅ Closed ETHUSDT SHORT | PnL: +$1.68 | ROI: 1.05% notional / 2.86% margin | Time: 5m | Reason: TP
[2026-01-07T09:29:22.694Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.80"}
[2026-01-07T09:29:22.706Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.61"}
[2026-01-07T09:29:22.719Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.19"}
[2026-01-07T09:29:22.724Z] [INFO] [STRATEGY] TAOUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:22.730Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.80"}

📅 Day Finished: 2025-01-23 | PnL: +$1.68 (+1.58%) | Eq: +$107.63
[2026-01-07T09:29:22.812Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.96"}
[2026-01-07T09:29:22.813Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.88"}
[2026-01-07T09:29:22.829Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:22.836Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.70"}
[2026-01-07T09:29:22.873Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.05"}

📅 Day Finished: 2025-01-24 | PnL: +$0.00 (0.00%) | Eq: +$107.63
[2026-01-07T09:29:22.956Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.55"}

📅 Day Finished: 2025-01-25 | PnL: +$0.00 (0.00%) | Eq: +$107.63
[2026-01-07T09:29:22.972Z] [INFO] [STRATEGY] TAOUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:22.995Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.17"}
[2026-01-07T09:29:22.996Z] [INFO] [STRATEGY] TAOUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.66) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":415.29,"impulseLow":404.27,"impulseATR":1.9343160765953296,"impulseVolumeRatio":2.17376881650493,"barsSinceImpulse":2,"pullbackLow":408,"pullbackHigh":409.0863763029688,"pullbackDepth":0.0026556159429866537,"pullback":{"occurred":true,"distanceFromEMA":0.2655615942986654,"level":408,"isValid":true,"low":408,"high":409.0863763029688}}
[2026-01-07T09:29:22.998Z] [INFO] [STRATEGY] TAOUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"TAOUSDT","type":"LONG","entry":409.18309210679854,"stopLoss":404.1313678468093,"takeProfit":420.2030921067986,"positionSize":73.98523282670644,"confidence":0.567063042943037,"timestamp":1767778162998,"tags":["momentum_pullback","vol:2.2"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":415.29,"impulseLow":404.27,"impulseATR":1.9343160765953296,"impulseVolumeRatio":2.17376881650493,"barsSinceImpulse":2,"pullbackLow":408,"pullbackHigh":409.0863763029688,"pullbackDepth":0.0026556159429866537,"pullback":{"occurred":true,"distanceFromEMA":0.2655615942986654,"level":408,"isValid":true,"low":408,"high":409.0863763029688}}}

🔥 OPEN TRADE [2025-01-26 07:30:00] TAOUSDT LONG @ 409.18309210679854 (Conf: 0.57)

   ✅ Closed TAOUSDT LONG | PnL: +$1.92 | ROI: 2.69% notional / 7.78% margin | Time: 3.5h | Reason: TP
[2026-01-07T09:29:23.016Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.17"}
[2026-01-07T09:29:23.025Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"2.22"}
[2026-01-07T09:29:23.041Z] [INFO] [STRATEGY] TAOUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.048Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.83"}
[2026-01-07T09:29:23.052Z] [INFO] [STRATEGY] TAOUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.54) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":455.79,"impulseLow":446.73,"impulseATR":2.6858281526088814,"impulseVolumeRatio":1.8257878028759018,"barsSinceImpulse":10,"pullbackLow":450.9,"pullbackHigh":451.0723169615776,"pullbackDepth":0.0003820162645722713,"pullback":{"occurred":true,"distanceFromEMA":0.038201626457227134,"level":450.9,"isValid":true,"low":450.9,"high":451.0723169615776}}
[2026-01-07T09:29:23.062Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"6.25"}

📅 Day Finished: 2025-01-26 | PnL: +$1.92 (+1.78%) | Eq: +$109.55
[2026-01-07T09:29:23.070Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.83"}
[2026-01-07T09:29:23.078Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.94"}
[2026-01-07T09:29:23.088Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"4.80"}
[2026-01-07T09:29:23.089Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.76"}
[2026-01-07T09:29:23.094Z] [INFO] [STRATEGY] BNBUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.104Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.80"}
[2026-01-07T09:29:23.105Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.88"}
[2026-01-07T09:29:23.109Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.89"}
[2026-01-07T09:29:23.116Z] [INFO] [STRATEGY] ETHUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.118Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.33"}
[3.9%] Eq: $110 | Free: $110 | Pos: 0  [2026-01-07T09:29:23.128Z] [INFO] [STRATEGY] BNBUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.128Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.133Z] [INFO] [STRATEGY] ZECUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.146Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.76"}
[2026-01-07T09:29:23.148Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.28"}
[2026-01-07T09:29:23.156Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.68) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":41.99,"impulseLow":41.14,"impulseATR":0.2300347651254123,"impulseVolumeRatio":2.760871501551119,"barsSinceImpulse":17,"pullbackLow":41.712303446571546,"pullbackHigh":41.72,"pullbackDepth":0.00018451518598849154,"pullback":{"occurred":true,"distanceFromEMA":0.018451518598849154,"level":41.72,"isValid":true,"low":41.712303446571546,"high":41.72}}
[2026-01-07T09:29:23.157Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"SHORT","entry":41.700801708315275,"stopLoss":42.180069530250826,"takeProfit":40.850801708315274,"positionSize":79.5733215926536,"confidence":0.5726857712046812,"timestamp":1767778163157,"tags":["momentum_pullback","vol:2.8"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":41.99,"impulseLow":41.14,"impulseATR":0.2300347651254123,"impulseVolumeRatio":2.760871501551119,"barsSinceImpulse":17,"pullbackLow":41.712303446571546,"pullbackHigh":41.72,"pullbackDepth":0.00018451518598849154,"pullback":{"occurred":true,"distanceFromEMA":0.018451518598849154,"level":41.72,"isValid":true,"low":41.712303446571546,"high":41.72}}}

🔥 OPEN TRADE [2025-01-27 12:05:00] ZECUSDT SHORT @ 41.700801708315275 (Conf: 0.57)

   ❌ Closed ZECUSDT SHORT | PnL: -$1.01 | ROI: -1.17% notional / -3.81% margin | Time: 45m | Reason: SL

📅 Day Finished: 2025-01-27 | PnL: -$1.01 (-0.92%) | Eq: +$108.54
[2026-01-07T09:29:23.283Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.74"}

📅 Day Finished: 2025-01-28 | PnL: +$0.00 (0.00%) | Eq: +$108.54
[2026-01-07T09:29:23.325Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.11"}

📅 Day Finished: 2025-01-29 | PnL: +$0.00 (0.00%) | Eq: +$108.54
[2026-01-07T09:29:23.421Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"5.04"}
[2026-01-07T09:29:23.424Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.65) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":44.98,"impulseLow":43.94,"impulseATR":0.19498635322133867,"impulseVolumeRatio":5.036965569795189,"barsSinceImpulse":6,"pullbackLow":44.3,"pullbackHigh":44.32449526827655,"pullbackDepth":0.0005526350188150794,"pullback":{"occurred":true,"distanceFromEMA":0.055263501881507936,"level":44.3,"isValid":true,"low":44.3,"high":44.32449526827655}}
[2026-01-07T09:29:23.425Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"LONG","entry":44.33424458593762,"stopLoss":43.91002729355732,"takeProfit":45.37424458593762,"positionSize":97.63845907128729,"confidence":0.671323840774773,"timestamp":1767778163425,"tags":["momentum_pullback","vol:5.0"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":44.98,"impulseLow":43.94,"impulseATR":0.19498635322133867,"impulseVolumeRatio":5.036965569795189,"barsSinceImpulse":6,"pullbackLow":44.3,"pullbackHigh":44.32449526827655,"pullbackDepth":0.0005526350188150794,"pullback":{"occurred":true,"distanceFromEMA":0.055263501881507936,"level":44.3,"isValid":true,"low":44.3,"high":44.32449526827655}}}

🔥 OPEN TRADE [2025-01-30 09:55:00] ZECUSDT LONG @ 44.33424458593762 (Conf: 0.67)

   ✅ Closed ZECUSDT LONG | PnL: +$2.19 | ROI: 2.35% notional / 6.73% margin | Time: 1.9h | Reason: TP
[2026-01-07T09:29:23.438Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"3.93"}
[2026-01-07T09:29:23.444Z] [INFO] [STRATEGY] ETHUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.58) → checking bounce | {"state":2,"direction":"BULLISH","impulseHigh":3277.5,"impulseLow":3209.67,"impulseATR":12.463563879821903,"impulseVolumeRatio":3.9272426998075947,"barsSinceImpulse":18,"pullbackLow":3238.03,"pullbackHigh":3238.473116570342,"pullbackDepth":0.00013682885557223586,"pullback":{"occurred":true,"distanceFromEMA":0.013682885557223586,"level":3238.03,"isValid":true,"low":3238.03,"high":3238.473116570342}}
[2026-01-07T09:29:23.446Z] [INFO] [STRATEGY] ETHUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ETHUSDT","type":"LONG","entry":3239.096294764333,"stopLoss":3213.102872240356,"takeProfit":3306.926294764333,"positionSize":117.60410626224579,"confidence":0.7188057199324881,"timestamp":1767778163446,"tags":["momentum_pullback","vol:3.9"],"metadata":{"state":4,"direction":"BULLISH","impulseHigh":3277.5,"impulseLow":3209.67,"impulseATR":12.463563879821903,"impulseVolumeRatio":3.9272426998075947,"barsSinceImpulse":18,"pullbackLow":3238.03,"pullbackHigh":3238.473116570342,"pullbackDepth":0.00013682885557223586,"pullback":{"occurred":true,"distanceFromEMA":0.013682885557223586,"level":3238.03,"isValid":true,"low":3238.03,"high":3238.473116570342}}}

🔥 OPEN TRADE [2025-01-30 15:15:00] ETHUSDT LONG @ 3239.096294764333 (Conf: 0.72)

📅 Day Finished: 2025-01-30 | PnL: +$2.69 (+2.48%) | Eq: +$111.24

   ❌ Closed ETHUSDT LONG | PnL: -$1.08 | ROI: -0.82% notional / -2.77% margin | Time: 13.7h | Reason: SL
[2026-01-07T09:29:23.510Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BULLISH","vol":"1.88"}
[2026-01-07T09:29:23.528Z] [INFO] [STRATEGY] ETHUSDT | ⏱️ TIMEOUT after 50 bars

📅 Day Finished: 2025-01-31 | PnL: -$1.59 (-1.43%) | Eq: +$109.65
[2026-01-07T09:29:23.605Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.81"}
[2026-01-07T09:29:23.607Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.04"}
[2026-01-07T09:29:23.614Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.49) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":42.9,"impulseLow":42.15,"impulseATR":0.17182324555287506,"impulseVolumeRatio":2.0351147383706385,"barsSinceImpulse":17,"pullbackLow":42.5157536770796,"pullbackHigh":42.52,"pullbackDepth":0.00009987645879816384,"pullback":{"occurred":true,"distanceFromEMA":0.009987645879816385,"level":42.52,"isValid":true,"low":42.5157536770796,"high":42.52}}
[2026-01-07T09:29:23.615Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"SHORT","entry":42.507162514801955,"stopLoss":42.863646491105754,"takeProfit":41.757162514801955,"positionSize":112.58278115312403,"confidence":0.7208464543864292,"timestamp":1767778163615,"tags":["momentum_pullback","vol:2.0"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":42.9,"impulseLow":42.15,"impulseATR":0.17182324555287506,"impulseVolumeRatio":2.0351147383706385,"barsSinceImpulse":17,"pullbackLow":42.5157536770796,"pullbackHigh":42.52,"pullbackDepth":0.00009987645879816384,"pullback":{"occurred":true,"distanceFromEMA":0.009987645879816385,"level":42.52,"isValid":true,"low":42.5157536770796,"high":42.52}}}

🔥 OPEN TRADE [2025-02-01 11:25:00] ZECUSDT SHORT @ 42.507162514801955 (Conf: 0.72)

   ❌ Closed ZECUSDT SHORT | PnL: -$1.08 | ROI: -0.86% notional / -2.88% margin | Time: 1.8h | Reason: SL
[2026-01-07T09:29:23.629Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"4.91"}
[2026-01-07T09:29:23.636Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.99"}
[2026-01-07T09:29:23.648Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.62"}
[2026-01-07T09:29:23.654Z] [INFO] [STRATEGY] ZECUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.61) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":41.98,"impulseLow":41.31,"impulseATR":0.168033449797928,"impulseVolumeRatio":1.6213364493736724,"barsSinceImpulse":8,"pullbackLow":41.716695159429975,"pullbackHigh":41.72,"pullbackDepth":0.00007922105424204901,"pullback":{"occurred":true,"distanceFromEMA":0.0079221054242049,"level":41.72,"isValid":true,"low":41.716695159429975,"high":41.72}}
[2026-01-07T09:29:23.655Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"3.57"}
[2026-01-07T09:29:23.656Z] [INFO] [STRATEGY] ZECUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ZECUSDT","type":"SHORT","entry":41.70829348694008,"stopLoss":42.056066899595855,"takeProfit":41.038293486940084,"positionSize":112.47353611956903,"confidence":0.6891519910798117,"timestamp":1767778163656,"tags":["momentum_pullback","vol:1.6"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":41.98,"impulseLow":41.31,"impulseATR":0.168033449797928,"impulseVolumeRatio":1.6213364493736724,"barsSinceImpulse":8,"pullbackLow":41.716695159429975,"pullbackHigh":41.72,"pullbackDepth":0.00007922105424204901,"pullback":{"occurred":true,"distanceFromEMA":0.0079221054242049,"level":41.72,"isValid":true,"low":41.716695159429975,"high":41.72}}}

🔥 OPEN TRADE [2025-02-01 19:40:00] ZECUSDT SHORT @ 41.70829348694008 (Conf: 0.69)

   ✅ Closed ZECUSDT SHORT | PnL: +$1.70 | ROI: 1.61% notional / 4.52% margin | Time: 5m | Reason: TP
[2026-01-07T09:29:23.661Z] [INFO] [STRATEGY] ZECUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.18"}
[2026-01-07T09:29:23.679Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.96"}
[2026-01-07T09:29:23.686Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"1.55"}
[2026-01-07T09:29:23.691Z] [INFO] [STRATEGY] TAOUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.06"}
[2026-01-07T09:29:23.695Z] [INFO] [STRATEGY] SOLUSDT | ⏱️ TIMEOUT after 50 bars

📅 Day Finished: 2025-02-01 | PnL: +$0.62 (+0.56%) | Eq: +$110.26
[2026-01-07T09:29:23.696Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.38"}
[2026-01-07T09:29:23.698Z] [INFO] [STRATEGY] ZECUSDT | ⏱️ TIMEOUT after 50 bars
[2026-01-07T09:29:23.698Z] [INFO] [STRATEGY] BNBUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.46) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":662.33,"impulseLow":654.5,"impulseATR":1.346986558714705,"impulseVolumeRatio":1.5474416723185844,"barsSinceImpulse":23,"pullbackLow":657.0244646558217,"pullbackHigh":658.12,"pullbackDepth":0.001667419408426734,"pullback":{"occurred":true,"distanceFromEMA":0.16674194084267338,"level":658.12,"isValid":true,"low":657.0244646558217,"high":658.12}}
[2026-01-07T09:29:23.703Z] [INFO] [STRATEGY] ETHUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.33) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":3178,"impulseLow":3144,"impulseATR":11.733003432765049,"impulseVolumeRatio":1.9600440074409178,"barsSinceImpulse":36,"pullbackLow":3148.5704077332502,"pullbackHigh":3155.29,"pullbackDepth":0.0021341724645082176,"pullback":{"occurred":true,"distanceFromEMA":0.21341724645082177,"level":3155.29,"isValid":true,"low":3148.5704077332502,"high":3155.29}}
[2026-01-07T09:29:23.719Z] [INFO] [STRATEGY] ETHUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.16"}
[2026-01-07T09:29:23.721Z] [INFO] [STRATEGY] BNBUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"4.93"}
[2026-01-07T09:29:23.723Z] [INFO] [STRATEGY] SOLUSDT | 🔥 IMPULSE DETECTED → WAITING_PULLBACK | {"dir":"BEARISH","vol":"2.78"}
[2026-01-07T09:29:23.727Z] [INFO] [STRATEGY] ETHUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.44) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":3151.99,"impulseLow":3108.77,"impulseATR":9.850243381310818,"impulseVolumeRatio":2.1617817297502704,"barsSinceImpulse":8,"pullbackLow":3127.590139444237,"pullbackHigh":3128,"pullbackDepth":0.00013104676044147284,"pullback":{"occurred":true,"distanceFromEMA":0.013104676044147284,"level":3128,"isValid":true,"low":3127.590139444237,"high":3128}}
[2026-01-07T09:29:23.729Z] [INFO] [STRATEGY] BNBUSDT | 🟢 PULLBACK CONFIRMED (Fib: 0.62) → checking bounce | {"state":2,"direction":"BEARISH","impulseHigh":661.32,"impulseLow":650.1,"impulseATR":1.9324314059711671,"impulseVolumeRatio":4.925559599563432,"barsSinceImpulse":8,"pullbackLow":656.391771783181,"pullbackHigh":657.09,"pullbackDepth":0.0010637370040794988,"pullback":{"occurred":true,"distanceFromEMA":0.10637370040794988,"level":657.09,"isValid":true,"low":656.391771783181,"high":657.09}}
[2026-01-07T09:29:23.730Z] [INFO] [STRATEGY] ETHUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"ETHUSDT","type":"SHORT","entry":3127.097627275172,"stopLoss":3147.7004867626215,"takeProfit":3083.877627275172,"positionSize":146.12134589025317,"confidence":0.8135970096289619,"timestamp":1767778163730,"tags":["momentum_pullback","vol:2.2"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":3151.99,"impulseLow":3108.77,"impulseATR":9.850243381310818,"impulseVolumeRatio":2.1617817297502704,"barsSinceImpulse":8,"pullbackLow":3127.590139444237,"pullbackHigh":3128,"pullbackDepth":0.00013104676044147284,"pullback":{"occurred":true,"distanceFromEMA":0.013104676044147284,"level":3128,"isValid":true,"low":3127.590139444237,"high":3128}}}

🔥 OPEN TRADE [2025-02-02 03:55:00] ETHUSDT SHORT @ 3127.097627275172 (Conf: 0.81)

   ✅ Closed ETHUSDT SHORT | PnL: +$1.87 | ROI: 1.38% notional / 3.85% margin | Time: 5m | Reason: TP
[2026-01-07T09:29:23.731Z] [INFO] [STRATEGY] BNBUSDT | 🎯🎯🎯 TRADE SIGNAL EMITTED! | {"symbol":"BNBUSDT","type":"SHORT","entry":656.2951502128824,"stopLoss":660.9548628119423,"takeProfit":645.0751502128824,"positionSize":135.2128444741066,"confidence":0.8000735244375863,"timestamp":1767778163731,"tags":["momentum_pullback","vol:4.9"],"metadata":{"state":4,"direction":"BEARISH","impulseHigh":661.32,"impulseLow":650.1,"impulseATR":1.9324314059711671,"impulseVolumeRatio":4.925559599563432,"barsSinceImpulse":8,"pullbackLow":656.391771783181,"pullbackHigh":657.09,"pullbackDepth":0.0010637370040794988,"pullback":{"occurred":true,"distanceFromEMA":0.10637370040794988,"level":657.09,"isValid":true,"low":656.391771783181,"high":657.09}}}

🔥 OPEN TRADE [2025-02-02 04:00:00] BNBUSDT SHORT @ 656.2951502128824 (Conf: 0.80)