import { Candle } from '../../../domain/entities/Candle';

/**
 * BinanceMapper
 * 
 * Infrastructure mapper responsible for converting raw Binance API responses
 * to domain entities. This keeps API-specific parsing logic isolated.
 * 
 * Binance Futures Kline Format:
 * [
 *   0: openTime (number),
 *   1: open (string),
 *   2: high (string),
 *   3: low (string),
 *   4: close (string),
 *   5: volume (string),
 *   6: closeTime (number),
 *   7: quoteAssetVolume (string),
 *   8: numberOfTrades (number),
 *   9: takerBuyBaseVolume (string),
 *   10: takerBuyQuoteVolume (string),
 *   11: ignore (string)
 * ]
 */
export class BinanceMapper {
    /**
     * Maps a single raw Binance kline array to a Candle domain entity.
     * 
     * @param raw - Raw kline array from Binance API
     * @returns Candle domain entity
     */
    static toDomain(raw: any[]): Candle {
        return new Candle(
            raw[0],                    // timestamp (openTime)
            parseFloat(raw[1]),        // open
            parseFloat(raw[2]),        // high
            parseFloat(raw[3]),        // low
            parseFloat(raw[4]),        // close
            parseFloat(raw[5])         // volume
        );
    }

    /**
     * Maps an array of raw Binance klines to Candle domain entities.
     * 
     * @param rawCandles - Array of raw kline arrays from Binance API
     * @returns Array of Candle domain entities
     */
    static toDomainArray(rawCandles: any[][]): Candle[] {
        return rawCandles.map(raw => BinanceMapper.toDomain(raw));
    }
}
