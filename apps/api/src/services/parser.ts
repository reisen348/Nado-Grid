import type {
  ExecutionMode,
  GridConfig,
  NadoNetwork,
  TradingViewWebhookPayload
} from "../../../../packages/shared/src/index.ts";

export interface StrategyCreateInput {
  name?: string;
  currentPrice?: number;
  executionMode?: ExecutionMode;
  config: GridConfig;
}

export interface StrategyStartInput {
  executionMode?: ExecutionMode;
  confirmPhrase?: string;
  currentPrice?: number;
}

export interface StrategyStopInput {
  closePosition?: boolean;
  reason?: "manual" | "emergency-stop";
}

export function parseStrategyCreateInput(body: unknown, defaultNetwork: NadoNetwork): StrategyCreateInput {
  const object = asObject(body);
  const configSource = asObject(object.config ?? object);
  return {
    name: optionalString(object.name),
    currentPrice: optionalNumber(object.currentPrice),
    executionMode: parseExecutionMode(object.executionMode),
    config: parseGridConfig(configSource, defaultNetwork)
  };
}

export function parseStrategyStartInput(body: unknown): StrategyStartInput {
  const object = asObject(body ?? {});
  return {
    executionMode: parseExecutionMode(object.executionMode),
    confirmPhrase: optionalString(object.confirmPhrase),
    currentPrice: optionalNumber(object.currentPrice)
  };
}

export function parseStrategyStopInput(body: unknown): StrategyStopInput {
  const object = asObject(body ?? {});
  return {
    closePosition: object.closePosition === undefined ? true : Boolean(object.closePosition),
    reason: object.reason === "emergency-stop" ? "emergency-stop" : "manual"
  };
}

export function parseTradingViewPayload(body: unknown): TradingViewWebhookPayload {
  const object = asObject(body);
  return {
    strategyId: requiredString(object.strategyId, "strategyId"),
    nonce: requiredString(object.nonce, "nonce"),
    symbol: requiredString(object.symbol, "symbol"),
    upper: requiredNumber(object.upper, "upper"),
    lower: requiredNumber(object.lower, "lower"),
    timestamp: requiredNumber(object.timestamp, "timestamp"),
    secret: requiredString(object.secret, "secret")
  };
}

function parseGridConfig(object: Record<string, unknown>, defaultNetwork: NadoNetwork): GridConfig {
  return {
    market: requiredString(object.market, "market"),
    productId: optionalInteger(object.productId),
    direction: object.direction === "short" ? "short" : "long",
    lowerPrice: requiredNumber(object.lowerPrice, "lowerPrice"),
    upperPrice: requiredNumber(object.upperPrice, "upperPrice"),
    gridCount: requiredInteger(object.gridCount, "gridCount"),
    marginPerGrid: requiredNumber(object.marginPerGrid, "marginPerGrid"),
    leverage: requiredNumber(object.leverage, "leverage"),
    takeProfitPrice: requiredNumber(object.takeProfitPrice, "takeProfitPrice"),
    stopLossPrice: requiredNumber(object.stopLossPrice, "stopLossPrice"),
    postOnly: object.postOnly === undefined ? true : Boolean(object.postOnly),
    network: object.network === "testnet" ? "testnet" : defaultNetwork
  };
}

function parseExecutionMode(value: unknown): ExecutionMode | undefined {
  return value === "live" ? "live" : value === "dry-run" ? "dry-run" : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredNumber(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
