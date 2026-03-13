import axios from 'axios';
import {
  Candle,
  ExchangeBalance,
  ExchangeOrder,
} from '../types';
import {
  CandleStreamMessage,
  ExchangeContract,
  PositionRisk,
  UserTrade,
} from './contracts/ExchangeContract';
import { config } from '../config/ConfigManager';
import { db } from './DatabaseManager';
import { logger } from './Logger';
import { Helpers } from '../utils/Helpers';

interface SimulationOrder extends ExchangeOrder {
  closePosition?: boolean;
  reduceOnly?: boolean;
}

interface SimulationPosition {
  symbol: string;
  amount: number;
  entryPrice: number;
  leverage: number;
  isolatedMargin: number;
  marginType: 'ISOLATED' | 'CROSSED';
}

interface ExecutionResult {
  fillPrice: number;
  realizedPnl: number;
  commission: number;
}

export interface SimulationExchangeOptions {
  initialBalance?: number;
  makerFee?: number;
  takerFee?: number;
  slippageBps?: number;
  defaultStepSize?: number;
  defaultTickSize?: number;
}

export interface HistoricalFeedConfig {
  symbols: string[];
  timeframe: string;
  startTime: number;
  endTime: number;
}

export class SimulationExchange implements ExchangeContract {
  private readonly initialBalance: number;
  private readonly makerFee: number;
  private readonly takerFee: number;
  private readonly slippageRate: number;
  private readonly defaultStepSize: number;
  private readonly defaultTickSize: number;

  private walletBalance: number;
  private lockedMargin = 0;
  private historicalData = new Map<string, Candle[]>();
  private latestCandles = new Map<string, Candle>();
  private positions = new Map<string, SimulationPosition>();
  private openOrders: SimulationOrder[] = [];
  private trades: UserTrade[] = [];
  private subscriptions: Array<{
    symbols: Set<string>;
    interval: string;
    callback: (data: CandleStreamMessage) => void;
  }> = [];
  private leverageBySymbol = new Map<string, number>();
  private stepSizeBySymbol = new Map<string, number>();
  private tickSizeBySymbol = new Map<string, number>();
  private marginTypeBySymbol = new Map<string, 'ISOLATED' | 'CROSSED'>();
  private currentReplayTimestamp: number | null = null;
  private feedTimeframe = config.getConfig().timeframe;
  private orderSequence = 0;
  private tradeSequence = 0;

  constructor(options: SimulationExchangeOptions = {}) {
    const feeConfig = config.getConfig().fees;
    this.initialBalance = options.initialBalance ?? config.getRiskConfig().accountBalance;
    this.walletBalance = this.initialBalance;
    this.makerFee = options.makerFee ?? feeConfig.maker;
    this.takerFee = options.takerFee ?? feeConfig.taker;
    // Small retail size on liquid futures should have minimal impact by default.
    this.slippageRate = (options.slippageBps ?? 0.5) / 10_000;
    this.defaultStepSize = options.defaultStepSize ?? 0.001;
    this.defaultTickSize = options.defaultTickSize ?? 0.01;
  }

  public async loadHistoricalData(feed: HistoricalFeedConfig): Promise<void> {
    this.historicalData.clear();
    this.latestCandles.clear();
    this.feedTimeframe = feed.timeframe;
    this.resetTradingState();

    for (const symbol of feed.symbols) {
      const candles = this.sanitizeCandles(
        db.getCandles(symbol, feed.timeframe, feed.startTime, feed.endTime)
      );

      if (candles.length === 0) {
        throw new Error(`SimulationExchange: no candles found for ${symbol} ${feed.timeframe}`);
      }

      this.historicalData.set(symbol, candles);
      this.latestCandles.set(symbol, candles[0]);

      if (!this.tickSizeBySymbol.has(symbol)) {
        this.tickSizeBySymbol.set(symbol, this.inferTickSize(candles));
      }
    }

    logger.info('SimulationExchange', `Loaded historical feed for ${feed.symbols.length} symbols`);
  }

  public async replayHistoricalFeed(): Promise<void> {
    const streams = Array.from(this.historicalData.entries()).map(([symbol, candles]) => ({
      symbol,
      candles,
      index: 0,
    }));

    while (true) {
      let nextTimestamp = Number.POSITIVE_INFINITY;

      for (const stream of streams) {
        if (stream.index >= stream.candles.length) continue;
        nextTimestamp = Math.min(nextTimestamp, stream.candles[stream.index].timestamp);
      }

      if (!Number.isFinite(nextTimestamp)) {
        break;
      }

      this.currentReplayTimestamp = nextTimestamp;

      for (const stream of streams) {
        while (
          stream.index < stream.candles.length &&
          stream.candles[stream.index].timestamp === nextTimestamp
        ) {
          const candle = stream.candles[stream.index];
          this.latestCandles.set(stream.symbol, candle);
          this.processConditionalOrders(stream.symbol, candle);
          this.emitClosedKline(stream.symbol, candle);
          stream.index += 1;
        }
      }
    }

    this.currentReplayTimestamp = null;
  }

  public async loadExchangeInfo(): Promise<void> {
    try {
      const response = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo', {
        timeout: 10_000,
      });

      for (const symbolData of response.data.symbols ?? []) {
        const lotSize = symbolData.filters.find((f: any) => f.filterType === 'LOT_SIZE');
        const priceFilter = symbolData.filters.find((f: any) => f.filterType === 'PRICE_FILTER');

        if (lotSize) {
          this.stepSizeBySymbol.set(symbolData.symbol, parseFloat(lotSize.stepSize));
        }

        if (priceFilter) {
          this.tickSizeBySymbol.set(symbolData.symbol, parseFloat(priceFilter.tickSize));
        }
      }

      logger.info('SimulationExchange', 'Loaded Binance exchange filters for simulation');
    } catch (error: any) {
      logger.warn('SimulationExchange', `Falling back to synthetic exchange info: ${error.message}`);

      for (const [symbol, candles] of this.historicalData.entries()) {
        if (!this.stepSizeBySymbol.has(symbol)) {
          this.stepSizeBySymbol.set(symbol, this.defaultStepSize);
        }

        if (!this.tickSizeBySymbol.has(symbol)) {
          this.tickSizeBySymbol.set(symbol, this.inferTickSize(candles));
        }
      }
    }
  }

  public getStepSize(symbol: string): number {
    return this.stepSizeBySymbol.get(symbol) ?? this.defaultStepSize;
  }

  public async getPositionRisk(symbol: string): Promise<PositionRisk | null> {
    const position = this.positions.get(symbol);
    if (!position) {
      return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
    }

    const currentPrice = await this.getCurrentPrice(symbol);
    const direction = position.amount > 0 ? 1 : -1;
    const unrealizedProfit = (currentPrice - position.entryPrice) * Math.abs(position.amount) * direction;

    return {
      positionAmt: position.amount,
      entryPrice: position.entryPrice,
      unrealizedProfit,
    };
  }

  public async getCandles(
    symbol: string,
    interval: string = '5m',
    limit: number = 1000,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    const loaded = this.historicalData.get(symbol);
    const source = loaded && loaded.length > 0
      ? loaded
      : this.sanitizeCandles(db.getCandles(symbol, interval, startTime ?? 0, endTime ?? Date.now()));

    let candles = source;
    if (startTime !== undefined) candles = candles.filter(c => c.timestamp >= startTime);
    if (endTime !== undefined) candles = candles.filter(c => c.timestamp <= endTime);
    if (limit > 0 && candles.length > limit) candles = candles.slice(-limit);

    return candles.map(c => ({ ...c }));
  }

  public async getUserTrades(symbol: string, limit: number = 50): Promise<UserTrade[]> {
    return this.trades
      .filter(trade => trade.symbol === symbol)
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map(trade => ({ ...trade }));
  }

  public subscribeToCandles(
    symbols: string[],
    interval: string,
    callback: (data: CandleStreamMessage) => void
  ): void {
    this.subscriptions.push({
      symbols: new Set(symbols),
      interval,
      callback,
    });
  }

  public closeConnection(): void {
    this.subscriptions = [];
  }

  public async getCurrentPrice(symbol: string): Promise<number> {
    const latest = this.latestCandles.get(symbol);
    if (latest) return latest.close;

    const candles = await this.getCandles(symbol, this.feedTimeframe, 1);
    if (candles.length === 0) {
      throw new Error(`SimulationExchange: no price available for ${symbol}`);
    }

    return candles[candles.length - 1].close;
  }

  public async get24hTicker(symbol: string): Promise<any> {
    const candles = await this.getCandles(symbol, this.feedTimeframe, 96);
    if (candles.length === 0) {
      return { symbol, volume: '0', priceChangePercent: '0', lastPrice: '0' };
    }

    const first = candles[0];
    const last = candles[candles.length - 1];
    const priceChangePercent = first.close > 0
      ? (((last.close - first.close) / first.close) * 100).toFixed(2)
      : '0';
    const volume = candles.reduce((sum, candle) => sum + candle.volume, 0).toFixed(8);

    return {
      symbol,
      volume,
      priceChangePercent,
      lastPrice: last.close.toString(),
    };
  }

  public async getOpenInterest(symbol: string): Promise<any> {
    const latest = this.latestCandles.get(symbol);
    return {
      symbol,
      openInterest: latest?.openInterest ?? 0,
    };
  }

  public async getBalance(): Promise<ExchangeBalance[]> {
    const free = this.getAvailableBalance();
    return [{
      asset: 'USDT',
      free,
      locked: this.lockedMargin,
      total: this.walletBalance,
    }];
  }

  public async getAccountInfo(): Promise<any> {
    return {
      asset: 'USDT',
      balance: this.walletBalance,
      availableBalance: this.getAvailableBalance(),
      totalMarginBalance: this.walletBalance,
      totalInitialMargin: this.lockedMargin,
      positions: Array.from(this.positions.values()).map(position => ({ ...position })),
      openOrders: this.openOrders.length,
      feeRates: {
        maker: this.makerFee,
        taker: this.takerFee,
      },
    };
  }

  public async setLeverage(symbol: string, leverage: number): Promise<void> {
    this.leverageBySymbol.set(symbol, leverage);
  }

  public async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    this.marginTypeBySymbol.set(symbol, marginType);
  }

  public async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<ExchangeOrder> {
    const normalizedQuantity = this.normalizeQuantity(symbol, quantity);
    if (normalizedQuantity <= 0) {
      throw new Error(`SimulationExchange: quantity for ${symbol} is 0 after normalization`);
    }

    const currentPrice = await this.getCurrentPrice(symbol);
    const fillPrice = this.getExecutionPrice(symbol, side, normalizedQuantity, currentPrice);
    const orderId = this.nextOrderId('sim-mkt');
    const timestamp = this.getSimulationTimestamp();

    this.executeMarketFill(symbol, side, normalizedQuantity, fillPrice, orderId, timestamp);

    return {
      orderId,
      symbol,
      side,
      type: 'MARKET',
      quantity: normalizedQuantity,
      price: fillPrice,
      status: 'FILLED',
      timestamp,
    };
  }

  public async placeStopLoss(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopPrice: number
  ): Promise<ExchangeOrder> {
    const normalizedQuantity = this.normalizeQuantity(symbol, quantity);
    const normalizedStop = this.normalizePrice(symbol, stopPrice);
    if (normalizedQuantity <= 0) {
      throw new Error(`SimulationExchange: stop loss quantity for ${symbol} is 0 after normalization`);
    }

    this.openOrders = this.openOrders.filter(
      order => !(order.symbol === symbol && order.type === 'STOP_MARKET')
    );

    const order: SimulationOrder = {
      orderId: this.nextOrderId('sim-sl'),
      symbol,
      side,
      type: 'STOP_MARKET',
      quantity: normalizedQuantity,
      stopPrice: normalizedStop,
      status: 'NEW',
      timestamp: this.getSimulationTimestamp(),
      closePosition: true,
      reduceOnly: true,
    };

    this.openOrders.push(order);
    return { ...order };
  }

  public async placeTakeProfit(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number
  ): Promise<ExchangeOrder> {
    const normalizedQuantity = this.normalizeQuantity(symbol, quantity);
    const normalizedPrice = this.normalizePrice(symbol, price);
    if (normalizedQuantity <= 0) {
      throw new Error(`SimulationExchange: take profit quantity for ${symbol} is 0 after normalization`);
    }

    this.openOrders = this.openOrders.filter(
      order => !(order.symbol === symbol && order.type === 'TAKE_PROFIT_MARKET')
    );

    const order: SimulationOrder = {
      orderId: this.nextOrderId('sim-tp'),
      symbol,
      side,
      type: 'TAKE_PROFIT_MARKET',
      quantity: normalizedQuantity,
      stopPrice: normalizedPrice,
      price: normalizedPrice,
      status: 'NEW',
      timestamp: this.getSimulationTimestamp(),
      closePosition: true,
      reduceOnly: true,
    };

    this.openOrders.push(order);
    return { ...order };
  }

  public async cancelOrder(symbol: string, orderId: string): Promise<void> {
    this.openOrders = this.openOrders.filter(
      order => !(order.symbol === symbol && order.orderId === orderId)
    );
  }

  public async getOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
    return this.openOrders
      .filter(order => !symbol || order.symbol === symbol)
      .map(order => ({ ...order }));
  }

  public async testConnection(): Promise<boolean> {
    return true;
  }

  private resetTradingState(): void {
    this.walletBalance = this.initialBalance;
    this.lockedMargin = 0;
    this.positions.clear();
    this.openOrders = [];
    this.trades = [];
    this.currentReplayTimestamp = null;
    this.orderSequence = 0;
    this.tradeSequence = 0;
  }

  private emitClosedKline(symbol: string, candle: Candle): void {
    for (const subscription of this.subscriptions) {
      if (!subscription.symbols.has(symbol)) continue;

      const message: CandleStreamMessage = {
        s: symbol,
        k: {
          t: candle.timestamp,
          o: candle.open.toString(),
          h: candle.high.toString(),
          l: candle.low.toString(),
          c: candle.close.toString(),
          v: candle.volume.toString(),
          V: candle.takerBuyBaseVolume.toString(),
          i: subscription.interval,
          x: true,
        },
      };

      subscription.callback(message);
    }
  }

  private processConditionalOrders(symbol: string, candle: Candle): void {
    const position = this.positions.get(symbol);
    if (!position) return;

    const symbolOrders = this.openOrders
      .filter(order => order.symbol === symbol && order.status === 'NEW' && order.stopPrice !== undefined)
      .sort((a, b) => this.getOrderPriority(a) - this.getOrderPriority(b));

    for (const order of symbolOrders) {
      if (!order.stopPrice) continue;
      if (!this.shouldTriggerOrder(order, position, candle)) continue;

      const quantity = order.closePosition
        ? Math.abs(position.amount)
        : Math.min(Math.abs(position.amount), order.quantity);

      if (quantity <= 0) continue;

      const triggerReference = this.getTriggeredReferencePrice(order, position, candle);
      const fillPrice = this.getExecutionPrice(symbol, order.side, quantity, triggerReference);
      const timestamp = candle.timestamp;
      const result = this.executeMarketFill(
        symbol,
        order.side,
        quantity,
        fillPrice,
        order.orderId,
        timestamp
      );

      order.status = 'FILLED';

      this.openOrders = this.openOrders.filter(openOrder => openOrder.orderId !== order.orderId);
      if (!this.positions.has(symbol)) {
        this.cancelReduceOnlyOrders(symbol);
      } else {
        this.trimOrderQuantities(symbol);
      }

      logger.info('SimulationExchange', `${order.type} triggered for ${symbol}`, {
        fillPrice,
        realizedPnl: result.realizedPnl,
      });
      break;
    }
  }

  private executeMarketFill(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    fillPrice: number,
    orderId: string,
    timestamp: number
  ): ExecutionResult {
    const position = this.positions.get(symbol);
    const sideSign = side === 'BUY' ? 1 : -1;
    const notional = quantity * fillPrice;
    const commission = notional * this.takerFee;
    const leverage = this.leverageBySymbol.get(symbol)
      ?? position?.leverage
      ?? config.getRiskConfig().leverage;
    const marginType = this.marginTypeBySymbol.get(symbol)
      ?? position?.marginType
      ?? 'ISOLATED';

    let realizedPnl = 0;
    let releasedMargin = 0;
    let openedMargin = 0;

    if (!position || Math.sign(position.amount) === sideSign) {
      openedMargin = notional / leverage;
      this.ensureSufficientBalance(openedMargin, commission, 0, 0);
      this.walletBalance -= commission;
      this.lockedMargin += openedMargin;

      if (!position) {
        this.positions.set(symbol, {
          symbol,
          amount: sideSign * quantity,
          entryPrice: fillPrice,
          leverage,
          isolatedMargin: openedMargin,
          marginType,
        });
      } else {
        const currentQty = Math.abs(position.amount);
        const totalQty = currentQty + quantity;
        position.entryPrice = ((currentQty * position.entryPrice) + (quantity * fillPrice)) / totalQty;
        position.amount = sideSign * totalQty;
        position.leverage = leverage;
        position.marginType = marginType;
        position.isolatedMargin += openedMargin;
      }

      this.recordTrade(orderId, symbol, side, fillPrice, quantity, 0, commission, timestamp);
      return { fillPrice, realizedPnl: 0, commission };
    }

    const closeQty = Math.min(Math.abs(position.amount), quantity);
    const openQty = Math.max(0, quantity - closeQty);
    const positionDirection = position.amount > 0 ? 1 : -1;
    realizedPnl = (fillPrice - position.entryPrice) * closeQty * positionDirection;
    releasedMargin = (closeQty * position.entryPrice) / position.leverage;
    openedMargin = openQty > 0 ? (openQty * fillPrice) / leverage : 0;

    this.ensureSufficientBalance(openedMargin, commission, releasedMargin, realizedPnl);
    this.walletBalance += realizedPnl - commission;
    this.lockedMargin = Math.max(0, this.lockedMargin - releasedMargin + openedMargin);

    const remainingQty = Math.abs(position.amount) - closeQty;
    if (remainingQty <= 1e-8) {
      this.positions.delete(symbol);
      this.cancelReduceOnlyOrders(symbol);
    } else {
      position.amount = position.amount > 0 ? remainingQty : -remainingQty;
      position.isolatedMargin = Math.max(0, position.isolatedMargin - releasedMargin);
    }

    if (openQty > 0) {
      this.positions.set(symbol, {
        symbol,
        amount: sideSign * openQty,
        entryPrice: fillPrice,
        leverage,
        isolatedMargin: openedMargin,
        marginType,
      });
    } else if (this.positions.has(symbol)) {
      this.trimOrderQuantities(symbol);
    }

    this.recordTrade(orderId, symbol, side, fillPrice, quantity, realizedPnl, commission, timestamp);
    return { fillPrice, realizedPnl, commission };
  }

  private ensureSufficientBalance(
    openedMargin: number,
    commission: number,
    releasedMargin: number,
    realizedPnl: number
  ): void {
    const projectedAvailable = this.getAvailableBalance() + releasedMargin + realizedPnl;
    if (projectedAvailable + 1e-8 < openedMargin + commission) {
      throw new Error(
        `SimulationExchange: insufficient balance. Need ${(openedMargin + commission).toFixed(4)} USDT, `
        + `available ${projectedAvailable.toFixed(4)} USDT`
      );
    }
  }

  private recordTrade(
    orderId: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    price: number,
    qty: number,
    realizedPnl: number,
    commission: number,
    time: number
  ): void {
    this.trades.push({
      id: ++this.tradeSequence,
      orderId,
      symbol,
      side,
      price,
      qty,
      realizedPnl,
      commission,
      time,
      maker: false,
    });
  }

  private getAvailableBalance(): number {
    return Math.max(0, this.walletBalance - this.lockedMargin);
  }

  private getExecutionPrice(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    referencePrice: number
  ): number {
    const slipped = this.applySlippage(referencePrice, side, symbol, quantity);
    return this.normalizePrice(symbol, slipped);
  }

  private shouldTriggerOrder(
    order: SimulationOrder,
    position: SimulationPosition,
    candle: Candle
  ): boolean {
    if (!order.stopPrice) return false;

    if (order.type === 'STOP_MARKET') {
      return position.amount > 0
        ? candle.low <= order.stopPrice
        : candle.high >= order.stopPrice;
    }

    return position.amount > 0
      ? candle.high >= order.stopPrice
      : candle.low <= order.stopPrice;
  }

  private getTriggeredReferencePrice(
    order: SimulationOrder,
    position: SimulationPosition,
    candle: Candle
  ): number {
    const stopPrice = order.stopPrice!;

    if (order.type === 'STOP_MARKET') {
      if (position.amount > 0) {
        return candle.open <= stopPrice ? candle.open : stopPrice;
      }
      return candle.open >= stopPrice ? candle.open : stopPrice;
    }

    if (position.amount > 0) {
      return candle.open >= stopPrice ? candle.open : stopPrice;
    }

    return candle.open <= stopPrice ? candle.open : stopPrice;
  }

  private getOrderPriority(order: SimulationOrder): number {
    return order.type === 'STOP_MARKET' ? 0 : 1;
  }

  private cancelReduceOnlyOrders(symbol: string): void {
    this.openOrders = this.openOrders.filter(
      order => !(order.symbol === symbol && order.reduceOnly)
    );
  }

  private trimOrderQuantities(symbol: string): void {
    const position = this.positions.get(symbol);
    if (!position) {
      this.cancelReduceOnlyOrders(symbol);
      return;
    }

    const maxQty = this.normalizeQuantity(symbol, Math.abs(position.amount));
    this.openOrders = this.openOrders
      .map(order => {
        if (order.symbol !== symbol || !order.reduceOnly) return order;
        return {
          ...order,
          quantity: order.closePosition ? order.quantity : Math.min(order.quantity, maxQty),
        };
      })
      .filter(order => order.quantity > 0);
  }

  private nextOrderId(prefix: string): string {
    this.orderSequence += 1;
    return `${prefix}-${this.getSimulationTimestamp()}-${this.orderSequence}`;
  }

  private getSimulationTimestamp(): number {
    return this.currentReplayTimestamp ?? Date.now();
  }

  private sanitizeCandles(candles: Candle[]): Candle[] {
    const deduped = new Map<number, Candle>();

    for (const candle of candles) {
      if (
        !Number.isFinite(candle.timestamp)
        || !Number.isFinite(candle.open)
        || !Number.isFinite(candle.high)
        || !Number.isFinite(candle.low)
        || !Number.isFinite(candle.close)
        || !Number.isFinite(candle.volume)
      ) {
        continue;
      }

      deduped.set(candle.timestamp, { ...candle });
    }

    return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  private inferTickSize(candles: Candle[]): number {
    const sample = candles.slice(0, 50);
    let maxDecimals = 0;

    for (const candle of sample) {
      for (const value of [candle.open, candle.high, candle.low, candle.close]) {
        const decimals = this.countDecimals(value);
        maxDecimals = Math.max(maxDecimals, decimals);
      }
    }

    if (maxDecimals <= 0) return this.defaultTickSize;
    return Number((1 / Math.pow(10, maxDecimals)).toFixed(maxDecimals));
  }

  private countDecimals(value: number): number {
    const text = value.toString();
    if (!text.includes('.')) return 0;
    return text.split('.')[1].replace(/0+$/, '').length;
  }

  private normalizeQuantity(symbol: string, quantity: number): number {
    return Helpers.floorToStep(quantity, this.getStepSize(symbol));
  }

  private normalizePrice(symbol: string, price: number): number {
    const tick = this.tickSizeBySymbol.get(symbol) ?? this.defaultTickSize;
    if (tick <= 0) return price;

    const normalized = Math.round(price / tick) * tick;
    const decimals = this.countDecimals(tick);
    return Number(normalized.toFixed(decimals));
  }

  private applySlippage(
    price: number,
    side: 'BUY' | 'SELL',
    symbol: string,
    quantity: number
  ): number {
    if (this.slippageRate <= 0) return price;

    const latest = this.latestCandles.get(symbol);
    const notional = price * quantity;
    const candleNotional = latest ? latest.close * latest.volume : Number.POSITIVE_INFINITY;
    const orderShare = candleNotional > 0 ? notional / candleNotional : 0;
    const impactMultiplier = 1 + Math.min(orderShare * 25, 1);
    const effectiveRate = this.slippageRate * impactMultiplier;

    return side === 'BUY'
      ? price * (1 + effectiveRate)
      : price * (1 - effectiveRate);
  }
}
