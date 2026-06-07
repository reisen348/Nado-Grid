import type {
  DexMarketPrice,
  DexPlacedOrder,
  FillEvent,
  MarketCandle,
  NadoNetwork,
  PlannedOrder
} from "../../shared/src/index.ts";

export interface DexAdapter {
  readonly name: string;
  readonly network: NadoNetwork;
  getMarketPrice(market: string, productId?: number): Promise<DexMarketPrice>;
  getCandlesticks(market: string, productId?: number, request?: CandlestickRequest): Promise<MarketCandle[]>;
  placeOrders(orders: PlannedOrder[], context: PlaceOrderContext): Promise<DexPlacedOrder[]>;
  cancelStrategyOrders(strategyId: string, market: string): Promise<void>;
  closePositionReduceOnly(params: ClosePositionParams): Promise<DexPlacedOrder | undefined>;
  listRecentFills(strategyId: string, market: string): Promise<FillEvent[]>;
}

export interface CandlestickRequest {
  intervalSeconds?: number;
  limit?: number;
}

export interface PlaceOrderContext {
  dryRun: boolean;
  allowLive: boolean;
}

export interface ClosePositionParams {
  strategyId: string;
  market: string;
  productId?: number;
  dryRun: boolean;
  reason: "take-profit" | "stop-loss" | "manual" | "emergency-stop";
}

export class LiveTradingDisabledError extends Error {
  constructor() {
    super("Live trading is disabled. Set LIVE_TRADING_ENABLED=true and confirm explicitly before placing orders.");
    this.name = "LiveTradingDisabledError";
  }
}
