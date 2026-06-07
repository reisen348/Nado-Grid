import type {
  DexMarketPrice,
  DexPlacedOrder,
  FillEvent,
  MarketCandle,
  NadoNetwork,
  PlannedOrder
} from "../../shared/src/index.ts";
import type { CandlestickRequest, ClosePositionParams, DexAdapter, PlaceOrderContext } from "./types.ts";

export class MockDexAdapter implements DexAdapter {
  readonly name = "mock";
  readonly network: NadoNetwork;

  private readonly orders = new Map<string, PlannedOrder>();
  private readonly fills: FillEvent[] = [];
  private readonly prices = new Map<string, number>();

  constructor(options: { network?: NadoNetwork; defaultPrice?: number } = {}) {
    this.network = options.network ?? "mainnet";
    this.prices.set("*", options.defaultPrice ?? 100);
  }

  setMarketPrice(market: string, price: number): void {
    this.prices.set(market.toUpperCase(), price);
  }

  async getMarketPrice(market: string): Promise<DexMarketPrice> {
    const normalized = market.toUpperCase();
    const markPrice = this.prices.get(normalized) ?? this.prices.get("*") ?? 100;
    return {
      market: normalized,
      markPrice,
      indexPrice: markPrice,
      updatedAt: new Date().toISOString()
    };
  }

  async getCandlesticks(market: string, _productId?: number, request: CandlestickRequest = {}): Promise<MarketCandle[]> {
    const normalized = market.toUpperCase();
    const basePrice = this.prices.get(normalized) ?? this.prices.get("*") ?? 100;
    const intervalSeconds = normalizeIntervalSeconds(request.intervalSeconds);
    const limit = normalizeLimit(request.limit);
    const endTime = Math.floor(Date.now() / 1000 / intervalSeconds) * intervalSeconds;
    const candles: MarketCandle[] = [];

    for (let index = 0; index < limit; index += 1) {
      const age = limit - index - 1;
      const time = endTime - age * intervalSeconds;
      const wave = Math.sin(index / 8) * basePrice * 0.025 + Math.cos(index / 19) * basePrice * 0.012;
      const trend = (index - limit / 2) * basePrice * 0.00004;
      const open = basePrice + wave + trend;
      const close = basePrice + Math.sin((index + 1) / 8) * basePrice * 0.025 + trend;
      const wick = basePrice * (0.0018 + (index % 5) * 0.00025);
      candles.push({
        time: new Date(time * 1000).toISOString(),
        open,
        high: Math.max(open, close) + wick,
        low: Math.min(open, close) - wick,
        close,
        volume: 10 + (index % 11)
      });
    }

    return candles;
  }

  async placeOrders(orders: PlannedOrder[], _context: PlaceOrderContext): Promise<DexPlacedOrder[]> {
    for (const order of orders) {
      this.orders.set(order.clientOrderId, order);
    }
    return orders.map((order) => ({
      exchangeOrderId: `mock_${order.clientOrderId}`,
      clientOrderId: order.clientOrderId,
      status: "open"
    }));
  }

  async cancelStrategyOrders(strategyId: string): Promise<void> {
    for (const [clientOrderId, order] of this.orders) {
      if (order.strategyId === strategyId) this.orders.delete(clientOrderId);
    }
  }

  async closePositionReduceOnly(params: ClosePositionParams): Promise<DexPlacedOrder | undefined> {
    return {
      exchangeOrderId: `mock_close_${params.strategyId}_${Date.now()}`,
      clientOrderId: `${params.strategyId}:close:${params.reason}`,
      status: "open"
    };
  }

  async listRecentFills(strategyId: string, market: string): Promise<FillEvent[]> {
    return this.fills.filter((fill) => fill.strategyId === strategyId && fill.market === market.toUpperCase());
  }

  simulateFill(order: PlannedOrder, filledAt = new Date().toISOString()): FillEvent {
    const fill: FillEvent = {
      strategyId: order.strategyId,
      clientOrderId: order.clientOrderId,
      market: order.market,
      side: order.side,
      price: order.price,
      amountBase: order.amountBase,
      reduceOnly: order.reduceOnly,
      gridIndex: order.gridIndex,
      pairedGridIndex: order.pairedGridIndex,
      filledAt
    };
    this.orders.delete(order.clientOrderId);
    this.fills.push(fill);
    return fill;
  }
}

function normalizeIntervalSeconds(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? Math.trunc(value) : 300;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return 120;
  return Math.min(Math.max(Math.trunc(value), 20), 500);
}
