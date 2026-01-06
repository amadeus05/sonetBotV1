/**
 * Helper Utilities
 * Common utility functions used across the application
 */

export class Helpers {
  /**
   * Generate unique ID
   */
  public static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Round to specified decimal places
   */
  public static roundTo(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }

  /**
   * Correctly round quantity DOWN to step size (CRITICAL for LOT_SIZE filter)
   * Example: quantity=150.567, step=1.0 -> 150
   * Example: quantity=0.1239, step=0.001 -> 0.123
   */
  public static floorToStep(value: number, stepSize: number): number {
    // Avoid division by zero
    if (stepSize === 0) return value;

    // 1. Calculate inverse factor (e.g. 1000 for 0.001)
    const precision = 1 / stepSize;
    
    // 2. Floor the value to precision
    // Using Math.floor to never exceed balance/margin limits
    const floored = Math.floor(value * precision) / precision;

    // 3. Clean up floating point artifacts (e.g. 0.300000000004)
    // Determine decimals count from stepSize
    const decimals = (stepSize.toString().split('.')[1] || '').length;
    
    return parseFloat(floored.toFixed(decimals));
  }

  /**
   * Calculate percentage
   */
  public static percentage(part: number, whole: number): number {
    if (whole === 0) return 0;
    return (part / whole) * 100;
  }

  /**
   * Calculate percentage difference
   */
  public static percentDiff(oldVal: number, newVal: number): number {
    if (oldVal === 0) return 0;
    return ((newVal - oldVal) / oldVal) * 100;
  }

  /**
   * Clamp value between min and max
   */
  public static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Sleep for specified milliseconds
   */
  public static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format number with commas
   */
  public static formatNumber(num: number, decimals: number = 2): string {
    return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Format currency
   */
  public static formatCurrency(amount: number, decimals: number = 2): string {
    const sign = amount >= 0 ? '+' : '-'; 
    return `${sign}$${this.formatNumber(Math.abs(amount), decimals)}`;
  }

  /**
   * Format percentage
   */
  public static formatPercent(value: number, decimals: number = 2): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(decimals)}%`;
  }

  /**
   * Format timestamp to readable date
   */
  public static formatDate(timestamp: number): string {
    return new Date(timestamp).toISOString().replace('T', ' ').substr(0, 19);
  }

  /**
   * Calculate time difference in human readable format
   */
  public static timeDiff(start: number, end: number): string {
    const diff = end - start;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Retry function with exponential backoff
   */
  public static async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await this.sleep(delayMs * Math.pow(2, i));
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Calculate R:R ratio
   */
  public static calculateRR(entry: number, sl: number, tp: number, isLong: boolean): number {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    return reward / risk;
  }

  /**
   * Calculate PnL
   */
  public static calculatePnL(
    entry: number,
    exit: number,
    size: number,
    isLong: boolean,
    leverage: number = 1
  ): { pnl: number; pnlPercent: number } {
    const priceDiff = isLong ? (exit - entry) : (entry - exit);
    // IMPORTANT:
    // - `size` is position NOTIONAL in USD (quantity * price).
    // - Leverage affects required margin and ROI on margin, but does NOT multiply the raw PnL for a given notional.
    // Therefore:
    // - `pnl` is computed from notional only (no leverage multiplier)
    // - `pnlPercent` is ROI on margin (so it does include leverage)
    const pnl = (priceDiff / entry) * size;
    const pnlPercent = (priceDiff / entry) * 100 * leverage;

    return { pnl, pnlPercent };
  }

  /**
   * Check if array is in ascending order
   */
  public static isAscending(arr: number[]): boolean {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] <= arr[i - 1]) return false;
    }
    return true;
  }

  /**
   * Check if array is in descending order
   */
  public static isDescending(arr: number[]): boolean {
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] >= arr[i - 1]) return false;
    }
    return true;
  }

  /**
   * Get last N elements from array
   */
  public static lastN<T>(arr: T[], n: number): T[] {
    return arr.slice(-n);
  }

  /**
   * Safe division (returns 0 if divisor is 0)
   */
  public static safeDivide(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Calculate Sharpe Ratio
   */
  public static sharpeRatio(returns: number[], riskFreeRate: number = 0): number {
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev === 0 ? 0 : (avgReturn - riskFreeRate) / stdDev;
  }

  /**
   * Calculate Maximum Drawdown
   */
  public static maxDrawdown(equityCurve: number[]): { amount: number; percent: number } {
    let maxDrawdown = 0;
    let peak = equityCurve[0];
    let peakPercent = 0;

    for (const value of equityCurve) {
      if (value > peak) {
        peak = value;
      }
      const drawdown = peak - value;
      const drawdownPercent = (drawdown / peak) * 100;

      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        peakPercent = drawdownPercent;
      }
    }

    return { amount: maxDrawdown, percent: peakPercent };
  }

  /**
   * Deep clone object
   */
  public static deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Calculate average of array
   */
  public static average(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  /**
   * Calculate median of array
   */
  public static median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * Normalize value to 0-1 range
   */
  public static normalize(value: number, min: number, max: number): number {
    if (max === min) return 0;
    return (value - min) / (max - min);
  }

  /**
   * Check if value is within range (inclusive)
   */
  public static inRange(value: number, min: number, max: number): boolean {
    return value >= min && value <= max;
  }
}