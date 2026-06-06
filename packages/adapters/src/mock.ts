import type {
  DexMarketPrice,
  DexPlacedOrder,
  FillEvent,
  NadoNetwork,
  PlannedOrder
} from "../../shared/src/index.ts";
import type { ClosePositionParams, DexAdapter, PlaceOrderContext } from "./types.ts";

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
