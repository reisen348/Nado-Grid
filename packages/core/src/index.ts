import type {
  FillEvent,
  GridConfig,
  GridLevel,
  GridPreview,
  OrderSide,
  PlannedOrder,
  RiskSummary,
  StrategyDirection
} from "../../shared/src/index.ts";

const DEFAULT_PRICE_DECIMALS = 6;
const DEFAULT_AMOUNT_DECIMALS = 8;

export class GridValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join("; "));
    this.issues = issues;
    this.name = "GridValidationError";
  }
}

export function normalizeMarket(market: string): string {
  return market.trim().toUpperCase();
}

export function makeStrategyId(prefix = "grid"): string {
  const random = crypto.randomUUID().split("-")[0];
  return `${prefix}_${random}`;
}

export function validateGridConfig(config: GridConfig, currentPrice?: number): string[] {
  const issues: string[] = [];
  if (!normalizeMarket(config.market)) issues.push("market is required");
  if (config.direction !== "long" && config.direction !== "short") {
    issues.push("direction must be long or short");
  }
  if (!Number.isFinite(config.lowerPrice) || config.lowerPrice <= 0) {
    issues.push("lowerPrice must be positive");
  }
  if (!Number.isFinite(config.upperPrice) || config.upperPrice <= 0) {
    issues.push("upperPrice must be positive");
  }
  if (config.upperPrice <= config.lowerPrice) {
    issues.push("upperPrice must be greater than lowerPrice");
  }
  if (!Number.isInteger(config.gridCount) || config.gridCount < 2) {
    issues.push("gridCount must be an integer >= 2");
  }
  if (!Number.isFinite(config.marginPerGrid) || config.marginPerGrid <= 0) {
    issues.push("marginPerGrid must be positive");
  }
  if (!Number.isFinite(config.leverage) || config.leverage < 1) {
    issues.push("leverage must be >= 1");
  }
  if (!Number.isFinite(config.takeProfitPrice) || config.takeProfitPrice <= 0) {
    issues.push("takeProfitPrice must be positive");
  }
  if (!Number.isFinite(config.stopLossPrice) || config.stopLossPrice <= 0) {
    issues.push("stopLossPrice must be positive");
  }
  if (currentPrice !== undefined) {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      issues.push("currentPrice must be positive");
    } else {
      if (currentPrice <= config.lowerPrice || currentPrice >= config.upperPrice) {
        issues.push("currentPrice must be inside the grid range for live start");
      }
      issues.push(...validateDirectionalRisk(config.direction, currentPrice, config.takeProfitPrice, config.stopLossPrice));
    }
  }
  return issues;
}

export function assertValidGridConfig(config: GridConfig, currentPrice?: number): void {
  const issues = validateGridConfig(config, currentPrice);
  if (issues.length > 0) throw new GridValidationError(issues);
}

export function validateDirectionalRisk(
  direction: StrategyDirection,
  currentPrice: number,
  takeProfitPrice: number,
  stopLossPrice: number
): string[] {
  if (direction === "long") {
    return [
      ...(takeProfitPrice <= currentPrice ? ["takeProfitPrice must be above currentPrice for long grids"] : []),
      ...(stopLossPrice >= currentPrice ? ["stopLossPrice must be below currentPrice for long grids"] : [])
    ];
  }
  return [
    ...(takeProfitPrice >= currentPrice ? ["takeProfitPrice must be below currentPrice for short grids"] : []),
    ...(stopLossPrice <= currentPrice ? ["stopLossPrice must be above currentPrice for short grids"] : [])
  ];
}

export function buildGridLevels(config: Pick<GridConfig, "lowerPrice" | "upperPrice" | "gridCount">): GridLevel[] {
  const { lowerPrice, upperPrice, gridCount } = config;
  const step = (upperPrice - lowerPrice) / gridCount;
  return Array.from({ length: gridCount + 1 }, (_, index) => ({
    index,
    price: roundPrice(lowerPrice + step * index)
  }));
}

export function buildInitialOrders(strategyId: string, config: GridConfig, currentPrice: number): PlannedOrder[] {
  assertValidGridConfig(config, currentPrice);
  const levels = buildGridLevels(config);
  const notional = config.marginPerGrid * config.leverage;
  const market = normalizeMarket(config.market);

  if (config.direction === "long") {
    return levels
      .filter((level) => level.index < config.gridCount && level.price < currentPrice)
      .map((level) =>
        buildOrder({
          strategyId,
          market,
          productId: config.productId,
          side: "buy",
          price: level.price,
          notional,
          margin: config.marginPerGrid,
          reduceOnly: false,
          postOnly: config.postOnly,
          intent: "entry",
          gridIndex: level.index,
          pairedGridIndex: level.index + 1
        })
      );
  }

  return levels
    .filter((level) => level.index > 0 && level.price > currentPrice)
    .map((level) =>
      buildOrder({
        strategyId,
        market,
        productId: config.productId,
        side: "sell",
        price: level.price,
        notional,
        margin: config.marginPerGrid,
        reduceOnly: false,
        postOnly: config.postOnly,
        intent: "entry",
        gridIndex: level.index,
        pairedGridIndex: level.index - 1
      })
    );
}

export function buildPreview(strategyId: string, config: GridConfig, currentPrice: number): GridPreview {
  const levels = buildGridLevels(config);
  const orders = buildInitialOrders(strategyId, config, currentPrice);
  return {
    strategyId,
    config: {
      ...config,
      market: normalizeMarket(config.market)
    },
    currentPrice,
    levels,
    orders,
    risk: buildRiskSummary(config, currentPrice, orders.length)
  };
}

export function buildRiskSummary(config: GridConfig, currentPrice: number, activeEntryOrders: number): RiskSummary {
  const priceStep = (config.upperPrice - config.lowerPrice) / config.gridCount;
  const warnings: string[] = [];
  if (activeEntryOrders === 0) {
    warnings.push("No entry orders would be placed at the current price.");
  }
  if (config.leverage >= 10) {
    warnings.push("Leverage is high; confirm liquidation risk before live start.");
  }
  if (currentPrice < config.lowerPrice || currentPrice > config.upperPrice) {
    warnings.push("Current price is outside the grid range.");
  }
  return {
    activeEntryOrders,
    marginAtRisk: roundMoney(activeEntryOrders * config.marginPerGrid),
    maxNotionalExposure: roundMoney(activeEntryOrders * config.marginPerGrid * config.leverage),
    priceStep: roundPrice(priceStep),
    lowerPrice: config.lowerPrice,
    upperPrice: config.upperPrice,
    stopLossPrice: config.stopLossPrice,
    takeProfitPrice: config.takeProfitPrice,
    warnings
  };
}

export function buildReplenishmentOrders(config: GridConfig, fill: FillEvent): PlannedOrder[] {
  const levels = buildGridLevels(config);
  const notional = config.marginPerGrid * config.leverage;
  const market = normalizeMarket(config.market);

  if (!fill.reduceOnly) {
    const paired = levels.find((level) => level.index === fill.pairedGridIndex);
    if (!paired) return [];
    const side: OrderSide = config.direction === "long" ? "sell" : "buy";
    return [
      buildOrder({
        strategyId: fill.strategyId,
        market,
        productId: config.productId,
        side,
        price: paired.price,
        notional,
        margin: 0,
        reduceOnly: true,
        postOnly: config.postOnly,
        intent: "take-profit",
        gridIndex: paired.index,
        pairedGridIndex: fill.gridIndex
      })
    ];
  }

  const paired = levels.find((level) => level.index === fill.pairedGridIndex);
  if (!paired) return [];
  const side: OrderSide = config.direction === "long" ? "buy" : "sell";
  return [
    buildOrder({
      strategyId: fill.strategyId,
      market,
      productId: config.productId,
      side,
      price: paired.price,
      notional,
      margin: config.marginPerGrid,
      reduceOnly: false,
      postOnly: config.postOnly,
      intent: "replenish",
      gridIndex: paired.index,
      pairedGridIndex: fill.gridIndex
    })
  ];
}

export function shouldTriggerGlobalRisk(config: GridConfig, currentPrice: number): "take-profit" | "stop-loss" | undefined {
  if (config.direction === "long") {
    if (currentPrice >= config.takeProfitPrice) return "take-profit";
    if (currentPrice <= config.stopLossPrice) return "stop-loss";
    return undefined;
  }
  if (currentPrice <= config.takeProfitPrice) return "take-profit";
  if (currentPrice >= config.stopLossPrice) return "stop-loss";
  return undefined;
}

function buildOrder(args: Omit<PlannedOrder, "clientOrderId" | "amountBase">): PlannedOrder {
  return {
    ...args,
    clientOrderId: [
      args.strategyId,
      args.intent,
      args.gridIndex,
      args.side,
      Math.round(args.price * 1_000_000)
    ].join(":"),
    amountBase: roundAmount(args.notional / args.price),
    notional: roundMoney(args.notional),
    margin: roundMoney(args.margin)
  };
}

function roundPrice(value: number): number {
  return round(value, DEFAULT_PRICE_DECIMALS);
}

function roundMoney(value: number): number {
  return round(value, 2);
}

function roundAmount(value: number): number {
  return round(value, DEFAULT_AMOUNT_DECIMALS);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
