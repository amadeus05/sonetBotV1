# 🤖 Professional Algo Trading Bot

**Target Performance:** 40-50% Win Rate | R:R 1:2-1:3 | Consistent Profitability

## 📋 Features

### ✅ Core Features
- **Trend-Following Momentum Strategy** - Combines EMA crossovers, RSI, volume analysis
- **Smart Entry System** - Waits for pullbacks to key levels for optimal entries
- **Risk Management** - Professional position sizing, stop losses, take profits
- **Order Flow Integration** - Uses CVD, OI, and liquidation data when available
- **Regime Detection** - Only trades in favorable market conditions
- **Backtesting Engine** - Test strategy on historical data
- **Real-time Monitoring** - Track positions and performance live
- **SQLite Database** - Persistent storage of all trades and signals

### 🏗️ Architecture
- **TypeScript** - Type-safe code
- **OOP + SOLID** - Clean, maintainable architecture
- **Modular Design** - Easy to extend and customize
- **Binance Futures** - Testnet and production support

## 🚀 Quick Start

### 1. Installation

```bash
cd algo-trader-pro
npm install
```

### 2. Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Binance API (Get from https://testnet.binancefuture.com)
BINANCE_API_KEY=your_testnet_api_key
BINANCE_API_SECRET=your_testnet_secret
BINANCE_USE_TESTNET=true

# Initial Balance
INITIAL_BALANCE=1000

# Risk Settings
RISK_PER_TRADE=0.01        # 1% risk per trade
MAX_OPEN_TRADES=2
LEVERAGE=2

# Strategy Parameters (defaults are good)
EMA_FAST=50
EMA_SLOW=200
RSI_PERIOD=14
STOP_LOSS_ATR_MULTIPLIER=1.5
TAKE_PROFIT_RATIO=2.5
```

### 3. Run Backtest (Recommended First!)

```bash
npm run build
npm run backtest
```

This will test the strategy on the last 30 days of data and show results.

### 4. Run Live Bot

```bash
npm run build
npm start
```

Or in development mode:

```bash
npm run dev
```

## 📊 Strategy Explanation

### How It Works

1. **Regime Detection**
   - Only trades in TRENDING markets
   - Avoids choppy/volatile conditions

2. **Trend Analysis**
   - Uses EMA 50/200 crossover
   - Confirms trend strength
   - Validates trend structure (HH/HL or LH/LL)

3. **Momentum Detection**
   - RSI extremes (>70 or <30)
   - Volume spikes (>1.5x average)
   - Significant price movement

4. **Pullback Entry**
   - Waits for price to pullback to EMA
   - Enters on bounce confirmation
   - Never chases price

5. **Order Flow Confirmation** (Optional)
   - CVD alignment (buyers/sellers)
   - OI confirmation (new money)
   - Liquidation support

6. **Risk Management**
   - ATR-based stop losses
   - R:R ratio 1:2.5
   - Position sizing based on account risk
   - Max 2 open trades
   - Daily loss limits

### Why This Works

- **High Quality Signals** - Multiple confirmations required
- **Optimal Entry** - Pullback entries = better R:R
- **Trend Following** - Trading with the trend (highest win rate)
- **Professional Risk** - Never risk more than 1% per trade

## 🎯 Performance Targets

| Metric | Target | Explanation |
|--------|--------|-------------|
| Win Rate | 40-50% | Realistic for trend-following |
| R:R Ratio | 1:2-1:3 | Risk $1 to make $2-3 |
| Max Drawdown | <15% | Stop if exceed 15% loss |
| Profit Factor | >1.5 | $1.50 profit per $1 risk |
| Sharpe Ratio | >1.0 | Risk-adjusted returns |

## 📁 Project Structure

```
algo-trader-pro/
├── src/
│   ├── core/                   # Core trading logic
│   │   ├── TradingBot.ts      # Main bot controller
│   │   ├── StrategyEngine.ts  # Strategy orchestrator
│   │   ├── RiskManager.ts     # Risk & position sizing
│   │   ├── TradeExecutor.ts   # Order execution
│   │   └── BacktestEngine.ts  # Backtesting
│   │
│   ├── modules/               # Strategy modules
│   │   ├── TrendAnalyzer.ts   # Trend detection
│   │   ├── MomentumDetector.ts # Momentum signals
│   │   ├── PullbackScanner.ts  # Entry timing
│   │   ├── RegimeDetector.ts   # Market regime
│   │   └── OrderFlowValidator.ts # Order flow
│   │
│   ├── services/              # External services
│   │   ├── BinanceService.ts  # Exchange API
│   │   ├── DatabaseManager.ts # SQLite database
│   │   └── Logger.ts          # Logging
│   │
│   ├── utils/                 # Utilities
│   │   ├── TechnicalIndicators.ts
│   │   └── Helpers.ts
│   │
│   ├── types/                 # TypeScript types
│   │   └── index.ts
│   │
│   ├── config/                # Configuration
│   │   └── ConfigManager.ts
│   │
│   ├── index.ts              # Main entry point
│   └── backtest.ts           # Backtest runner
│
├── data/                      # SQLite database
├── logs/                      # Log files
├── backtest-results/          # Backtest outputs
├── .env                       # Configuration (create from .env.example)
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠️ Commands

```bash
# Development
npm run dev          # Run in development mode

# Production
npm run build        # Compile TypeScript
npm start            # Run compiled bot

# Testing
npm run backtest     # Run strategy backtest
```

## 💻 Interactive Commands

When bot is running, you can type:

- `status` - Show current status
- `stats` - Show performance statistics
- `stop` - Gracefully stop the bot
- `emergency` - Emergency stop (close all positions)
- `help` - Show help

## ⚙️ Configuration Guide

### Risk Parameters

```typescript
RISK_PER_TRADE=0.01     // 1% account risk per trade
MAX_OPEN_TRADES=2       // Maximum 2 positions at once
LEVERAGE=2              // 2x leverage (conservative)
```

### Strategy Parameters

```typescript
EMA_FAST=50                     // Fast EMA period
EMA_SLOW=200                    // Slow EMA period
MIN_TREND_STRENGTH=0.02         // Minimum 2% between EMAs
RSI_PERIOD=14                   // RSI lookback
RSI_OVERBOUGHT=70               // RSI overbought level
RSI_OVERSOLD=30                 // RSI oversold level
VOLUME_SPIKE_MULTIPLIER=1.5     // 1.5x average volume
STOP_LOSS_ATR_MULTIPLIER=1.5    // SL = 1.5 * ATR
TAKE_PROFIT_RATIO=2.5           // TP = 2.5 * SL (R:R 1:2.5)
```

## 📈 Optimization Tips

1. **Start with defaults** - They're already optimized
2. **Run 30-day backtest** - See results before going live
3. **Use testnet first** - Test with fake money
4. **Start small** - Low leverage, small risk
5. **Monitor daily** - Check performance regularly

## 🔒 Safety Features

- **Daily Loss Limits** - Auto-stops at 5% daily loss
- **Max Drawdown** - Emergency stops at 15% drawdown
- **Position Limits** - Max 2 open trades
- **ATR-Based SL** - Dynamic stop losses based on volatility
- **Emergency Stop** - Manual override to close all

## 📊 Database

All trades are stored in SQLite database (`data/trading.db`):

- `positions` - All positions (open and closed)
- `trades` - Completed trades with analysis
- `signals` - All generated signals
- `performance_metrics` - Daily performance

## 🐛 Troubleshooting

### Bot won't start
- Check API keys in `.env`
- Verify internet connection
- Test with `npm run backtest` first

### No trades being executed
- Check regime (must be TRENDING)
- Verify signal confidence threshold
- Check risk limits not exceeded
- Review logs in `logs/` folder

### Poor performance
- Run longer backtest (60+ days)
- Adjust parameters gradually
- Check if symbols are suitable
- Verify strategy matches market conditions

## 📚 Further Development

### Easy Additions
- **More symbols** - Add to `symbols` array in config
- **Different timeframe** - Change `timeframe` parameter
- **Alerts** - Add Telegram/Discord notifications
- **Web dashboard** - Add Express.js API

### Advanced Features
- **Machine learning** - Add ML-based filters
- **Multi-strategy** - Run multiple strategies
- **Portfolio balancing** - Distribute capital
- **Auto-optimization** - Genetic algorithms

## ⚠️ Disclaimers

- **Not financial advice** - This is educational software
- **Test thoroughly** - Use testnet before real money
- **Past performance** - Does not guarantee future results
- **Risk warning** - You can lose money trading
- **No warranty** - Use at your own risk

## 📝 License

MIT License - Feel free to modify and use

## 🤝 Support

For issues or questions:
1. Check logs in `logs/` folder
2. Review backtest results
3. Verify configuration
4. Check Binance API status

---

**Remember:** Start with testnet, run backtests, understand the strategy, and never risk more than you can afford to lose!

Good luck! 🚀



# 1) Простая проверка дефолтной БД
npm run validate-db

# 2) Проверка конкретной БД (важно: аргументы после --)
npm run validate-db -- --db ./data15m360-200%/trading.db --timeframe 15m

# 3) Ограничить монеты / скорость / лимит проблем
npm run validate-db -- --db ./data/trading.db --max-symbols 5 --delay-ms 120 --max-issues 50

# 4) Проверить только выбранные монеты
npm run validate-db -- --db ./data/trading.db --symbols BTCUSDT,ETHUSDT

npm run validate-db -- --include-live