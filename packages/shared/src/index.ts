export type StrategyDirection = "long" | "short";
export type StrategyStatus =
  | "draft"
  | "ready"
  | "running"
  | "stopping"
  | "stopped"
  | "error";
export type ExecutionMode = "dry-run" | "live";
export type OrderSide = "buy" | "sell";
export type OrderIntent =
  | "entry"
  | "take-profit"
  | "stop-loss"
  | "close"
  | "replenish";
export type NadoNetwork = "mainnet" | "testnet";

export interface GridConfig {
  market: string;
  productId?: number;
  direction: StrategyDirection;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  marginPerGrid: number;
  leverage: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  postOnly: boolean;
  network: NadoNetwork;
}

export interface StrategyRecord {
  id: string;
  name: string;
  status: StrategyStatus;
  config: GridConfig;
  currentPrice?: number;
  executionMode: ExecutionMode;
  createdAt: string;
  updatedAt: string;
  lastWebhookNonce?: string;
  error?: string;
}

export interface GridLevel {
  index: number;
  price: number;
}

export interface PlannedOrder {
  clientOrderId: string;
  strategyId: string;
  market: string;
  productId?: number;
  side: OrderSide;
  price: number;
  amountBase: number;
  notional: number;
  margin: number;
  reduceOnly: boolean;
  postOnly: boolean;
  intent: OrderIntent;
  gridIndex: number;
  pairedGridIndex?: number;
}

export interface RiskSummary {
  activeEntryOrders: number;
  marginAtRisk: number;
  maxNotionalExposure: number;
  priceStep: number;
  lowerPrice: number;
  upperPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  warnings: string[];
}

export interface GridPreview {
  strategyId: string;
  config: GridConfig;
  currentPrice: number;
  levels: GridLevel[];
  orders: PlannedOrder[];
  risk: RiskSummary;
}

export interface TradingViewWebhookPayload {
  strategyId: string;
  nonce: string;
  symbol: string;
  upper: number;
  lower: number;
  timestamp: number;
  secret: string;
}

export interface AuditEvent {
  id: string;
  strategyId?: string;
  level: "info" | "warn" | "error";
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface DexMarketPrice {
  market: string;
  markPrice: number;
  indexPrice?: number;
  updatedAt: string;
}

export interface DexPlacedOrder {
  exchangeOrderId: string;
  clientOrderId: string;
  status: "open" | "filled" | "cancelled" | "rejected";
  rejectionReason?: string;
}

export interface FillEvent {
  strategyId: string;
  clientOrderId: string;
  market: string;
  side: OrderSide;
  price: number;
  amountBase: number;
  reduceOnly: boolean;
  gridIndex: number;
  pairedGridIndex?: number;
  filledAt: string;
}

export interface StrategyStatusResponse {
  strategy: StrategyRecord;
  preview?: GridPreview;
  audit: AuditEvent[];
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
