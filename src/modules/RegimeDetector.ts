import { Candle, MarketRegime } from '../types';

export class RegimeDetector {
  /**
   * Профессиональный расчет ADX по методу Уайлдера (Wilder's Smoothing)
   * Используется квантами для стабильности на малых таймфреймах.
   */
  public calculateStandardADX(candles: Candle[], period: number = 14): number {
    if (candles.length < period * 2) return 0;

    const n = candles.length;
    let trs: number[] = [];
    let plusDM: number[] = [];
    let minusDM: number[] = [];

    // 1. Расчет базовых компонентов (TR, +DM, -DM)
    for (let i = 1; i < n; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const prevHigh = candles[i - 1].high;
      const prevLow = candles[i - 1].low;

      // True Range
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);

      // Directional Movement
      const upMove = high - prevHigh;
      const downMove = prevLow - low;

      if (upMove > downMove && upMove > 0) {
        plusDM.push(upMove);
      } else {
        plusDM.push(0);
      }

      if (downMove > upMove && downMove > 0) {
        minusDM.push(downMove);
      } else {
        minusDM.push(0);
      }
    }

    // 2. Сглаживание по Уайлдеру (Wilder's Smoothing)
    let smoothTR = 0;
    let smoothPlusDM = 0;
    let smoothMinusDM = 0;

    // Начальное значение - сумма первых 'period' элементов
    for (let i = 0; i < period; i++) {
      smoothTR += trs[i];
      smoothPlusDM += plusDM[i];
      smoothMinusDM += minusDM[i];
    }

    const dxList: number[] = [];

    // Итеративный расчет сглаженных значений
    for (let i = period; i < trs.length; i++) {
      // Формула: SmoothValue = PrevSmooth - (PrevSmooth / n) + NewValue
      smoothTR = smoothTR - (smoothTR / period) + trs[i];
      smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDM[i];
      smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDM[i];

      const diPlus = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
      const diMinus = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

      const sum = diPlus + diMinus;
      const diff = Math.abs(diPlus - diMinus);
      const dx = sum !== 0 ? (diff / sum) * 100 : 0;
      dxList.push(dx);
    }

    // 3. Финальное сглаживание ADX
    if (dxList.length < period) return 0;

    let adx = dxList.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dxList.length; i++) {
      adx = ((adx * (period - 1)) + dxList[i]) / period;
    }

    return adx;
  }

  // Остальные методы (detect, classifyRegime и т.д.) оставляем, 
  // но следим, чтобы они вызывали обновленный calculateStandardADX
  public detect(candles: Candle[]): MarketRegime {
    const adx = this.calculateStandardADX(candles, 14);
    if (adx > 25) return MarketRegime.TRENDING;
    if (adx < 20) return MarketRegime.RANGING;
    return MarketRegime.UNKNOWN;
  }
}