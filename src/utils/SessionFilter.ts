export enum MarketSession {
  ASIA = 'ASIA',
  LONDON = 'LONDON',
  NY = 'NY',
  OFF = 'OFF'
}

export class SessionFilter {
  /**
   * Get the market session based on timestamp (UTC)
   * Asia: 00:00 - 07:00 UTC
   * London: 07:00 - 13:00 UTC (Morning/Overlap)
   * NY: 13:00 - 21:00 UTC
   */
  static getSession(timestamp: number): MarketSession {
    const date = new Date(timestamp);
    const utcHour = date.getUTCHours();

    if (utcHour >= 0 && utcHour < 7) return MarketSession.ASIA;
    if (utcHour >= 7 && utcHour < 13) return MarketSession.LONDON;
    if (utcHour >= 13 && utcHour < 21) return MarketSession.NY;

    return MarketSession.OFF;
  }

  /**
   * Check if the current session is preferred for trading
   */
  static isTradable(session: MarketSession): boolean {
    // Example: Prefer London and NY volatility
    return session === MarketSession.LONDON || session === MarketSession.NY;
  }
}