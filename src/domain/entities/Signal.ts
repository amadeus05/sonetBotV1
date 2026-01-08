/**
 * Signal Domain Entity
 * 
 * Re-exports trading signal types from core types for domain layer consistency.
 * This provides a clean import path for domain services.
 */

// Re-export from centralized types
export { TradingSignal, SignalType } from '../../types';
