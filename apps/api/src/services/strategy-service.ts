import { buildPreview, buildReplenishmentOrders, makeStrategyId, normalizeMarket, shouldTriggerGlobalRisk } from "../../../../packages/core/src/index.ts";
import type { DexAdapter } from "../../../../packages/adapters/src/index.ts";
import type {
  ExecutionMode,
  FillEvent,
  GridPreview,
  StrategyRecord,
  StrategyStatusResponse,
  TradingViewWebhookPayload
} from "../../../../packages/shared/src/index.ts";
import type { AppConfig } from "../config.ts";
import { writeAudit } from "./audit.ts";
import type { StrategyCreateInput, StrategyStartInput, StrategyStopInput } from "./parser.ts";
import type { StrategyStore } from "../store/types.ts";

export class StrategyService {
  private readonly store: StrategyStore;
  private readonly adapter: DexAdapter;
  private readonly appConfig: AppConfig;

  constructor(
    store: StrategyStore,
    adapter: DexAdapter,
    appConfig: AppConfig
  ) {
    this.store = store;
    this.adapter = adapter;
    this.appConfig = appConfig;
  }

  async createStrategy(input: StrategyCreateInput): Promise<{ strategy: StrategyRecord; preview: GridPreview }> {
    const now = new Date().toISOString();
    const id = makeStrategyId();
    const currentPrice = await this.resolveCurrentPrice(
      input.config.market,
      input.config.productId,
      input.currentPrice,
      midpoint(input.config.lowerPrice, input.config.upperPrice)
    );
    const strategy: StrategyRecord = {
      id,
      name: input.name ?? `${normalizeMarket(input.config.market)} ${input.config.direction} grid`,
      status: "draft",
      config: {
        ...input.config,
        market: normalizeMarket(input.config.market)
      },
      currentPrice,
      executionMode: input.executionMode ?? "dry-run",
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now
    };
    const preview = buildPreview(strategy.id, strategy.config, currentPrice);
    await this.store.upsertStrategy({ ...strategy, status: "ready" });
    await writeAudit(this.store, {
      strategyId: strategy.id,
      level: "info",
      type: "strategy.created",
      message: "Strategy draft created",
      metadata: { market: strategy.config.market, direction: strategy.config.direction }
    });
    return { strategy: { ...strategy, status: "ready" }, preview };
  }

  async updateStrategy(id: string, input: StrategyCreateInput): Promise<{ strategy: StrategyRecord; preview: GridPreview }> {
    const strategy = await this.requireStrategy(id);
    if (strategy.status === "running" && strategy.executionMode === "live") {
      throw new Error("running live strategies must be stopped before editing grid parameters");
    }
    if (strategy.status === "running") {
      await this.adapter.cancelStrategyOrders(strategy.id, strategy.config.market);
    }
    const now = new Date().toISOString();
    const nextConfig = {
      ...input.config,
      market: normalizeMarket(input.config.market)
    };
    const currentPrice = await this.resolveCurrentPrice(
      nextConfig.market,
      nextConfig.productId,
      input.currentPrice,
      strategy.currentPrice ?? midpoint(nextConfig.lowerPrice, nextConfig.upperPrice)
    );
    const updated: StrategyRecord = {
      ...strategy,
      name: input.name ?? strategy.name,
      status: "ready",
      config: nextConfig,
      currentPrice,
      executionMode: input.executionMode ?? strategy.executionMode,
      updatedAt: now,
      lastSyncedAt: now
    };
    const preview = buildPreview(updated.id, updated.config, currentPrice);
    await this.store.upsertStrategy(updated);
    await writeAudit(this.store, {
      strategyId: updated.id,
      level: "info",
      type: "strategy.updated",
      message: "Strategy grid parameters updated",
      metadata: { market: updated.config.market, direction: updated.config.direction }
    });
    return { strategy: updated, preview };
  }

  async listStrategies(): Promise<StrategyRecord[]> {
    return this.store.listStrategies();
  }

  async getStatus(id: string): Promise<StrategyStatusResponse> {
    const strategy = await this.requireStrategy(id);
    const audit = await this.store.listAudit(id);
    const preview = strategy.currentPrice ? buildPreview(strategy.id, strategy.config, strategy.currentPrice) : undefined;
    return { strategy, preview, audit };
  }

  async preview(id: string, currentPriceOverride?: number): Promise<GridPreview> {
    const strategy = await this.requireStrategy(id);
    const currentPrice = await this.resolveCurrentPrice(
      strategy.config.market,
      strategy.config.productId,
      currentPriceOverride,
      strategy.currentPrice ?? midpoint(strategy.config.lowerPrice, strategy.config.upperPrice)
    );
    const preview = buildPreview(strategy.id, strategy.config, currentPrice);
    const now = new Date().toISOString();
    await this.store.upsertStrategy({
      ...strategy,
      currentPrice,
      status: strategy.status === "draft" ? "ready" : strategy.status,
      updatedAt: now,
      lastSyncedAt: now
    });
    return preview;
  }

  async syncStatus(id: string, currentPriceOverride?: number): Promise<StrategyStatusResponse> {
    const strategy = await this.requireStrategy(id);
    if (strategy.status === "running") {
      await this.tickStrategy(strategy, currentPriceOverride);
    } else {
      await this.preview(id, currentPriceOverride);
    }
    return this.getStatus(id);
  }

  async applyTradingViewWebhook(payload: TradingViewWebhookPayload): Promise<{ strategy: StrategyRecord; preview: GridPreview; duplicate: boolean }> {
    if (payload.secret !== this.appConfig.tradingViewWebhookSecret) {
      throw new Error("invalid TradingView webhook secret");
    }
    const reserved = await this.store.reserveWebhookNonce(payload.strategyId, payload.nonce);
    const strategy = await this.requireStrategy(payload.strategyId);
    if (!reserved) {
      const preview = buildPreview(strategy.id, strategy.config, strategy.currentPrice ?? midpoint(strategy.config.lowerPrice, strategy.config.upperPrice));
      return { strategy, preview, duplicate: true };
    }

    const previousPrice = strategy.currentPrice;
    const currentPrice =
      previousPrice && previousPrice > payload.lower && previousPrice < payload.upper
        ? previousPrice
        : midpoint(payload.lower, payload.upper);
    const updated: StrategyRecord = {
      ...strategy,
      status: strategy.status === "draft" ? "ready" : strategy.status,
      lastWebhookNonce: payload.nonce,
      config: {
        ...strategy.config,
        market: normalizeMarket(payload.symbol),
        lowerPrice: payload.lower,
        upperPrice: payload.upper
      },
      currentPrice,
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    };
    const preview = buildPreview(updated.id, updated.config, currentPrice);
    await this.store.upsertStrategy(updated);
    await writeAudit(this.store, {
      strategyId: updated.id,
      level: "info",
      type: "tradingview.range_updated",
      message: "TradingView webhook updated grid range",
      metadata: { nonce: payload.nonce, lower: payload.lower, upper: payload.upper }
    });
    return { strategy: updated, preview, duplicate: false };
  }

  async start(id: string, input: StrategyStartInput): Promise<{ strategy: StrategyRecord; preview: GridPreview }> {
    const strategy = await this.requireStrategy(id);
    const executionMode: ExecutionMode = input.executionMode ?? strategy.executionMode ?? "dry-run";
    if (executionMode === "live" && input.confirmPhrase !== "START LIVE") {
      throw new Error('Live start requires confirmPhrase "START LIVE"');
    }
    const currentPrice = await this.resolveCurrentPrice(
      strategy.config.market,
      strategy.config.productId,
      input.currentPrice ?? strategy.currentPrice,
      midpoint(strategy.config.lowerPrice, strategy.config.upperPrice)
    );
    const preview = buildPreview(strategy.id, strategy.config, currentPrice);
    await this.adapter.placeOrders(preview.orders, {
      dryRun: executionMode === "dry-run",
      allowLive: executionMode === "live" && this.appConfig.liveTradingEnabled
    });
    const updated: StrategyRecord = {
      ...strategy,
      status: "running",
      executionMode,
      currentPrice,
      updatedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString()
    };
    await this.store.upsertStrategy(updated);
    await writeAudit(this.store, {
      strategyId: strategy.id,
      level: "info",
      type: "strategy.started",
      message: executionMode === "live" ? "Strategy started live" : "Strategy started in dry-run",
      metadata: { orderCount: preview.orders.length, executionMode }
    });
    return { strategy: updated, preview };
  }

  async stop(id: string, input: StrategyStopInput): Promise<StrategyRecord> {
    const strategy = await this.requireStrategy(id);
    const reason = input.reason ?? "manual";
    await this.adapter.cancelStrategyOrders(strategy.id, strategy.config.market);
    if (input.closePosition ?? true) {
      await this.adapter.closePositionReduceOnly({
        strategyId: strategy.id,
        market: strategy.config.market,
        productId: strategy.config.productId,
        dryRun: strategy.executionMode !== "live",
        reason
      });
    }
    const updated: StrategyRecord = {
      ...strategy,
      status: "stopped",
      updatedAt: new Date().toISOString()
    };
    await this.store.upsertStrategy(updated);
    await writeAudit(this.store, {
      strategyId: strategy.id,
      level: "warn",
      type: "strategy.stopped",
      message: `Strategy stopped: ${reason}`,
      metadata: { closePosition: input.closePosition ?? true }
    });
    return updated;
  }

  async tickRunningStrategies(): Promise<void> {
    const strategies = await this.store.listStrategies();
    for (const strategy of strategies.filter((item) => item.status === "running")) {
      await this.tickStrategy(strategy);
    }
  }

  private async tickStrategy(strategy: StrategyRecord, currentPriceOverride?: number): Promise<void> {
    const price = await this.resolveCurrentPrice(
      strategy.config.market,
      strategy.config.productId,
      currentPriceOverride,
      strategy.currentPrice ?? midpoint(strategy.config.lowerPrice, strategy.config.upperPrice)
    );
    const riskTrigger = shouldTriggerGlobalRisk(strategy.config, price);
    if (riskTrigger) {
      await this.stop(strategy.id, {
        closePosition: true,
        reason: "emergency-stop"
      });
      await writeAudit(this.store, {
        strategyId: strategy.id,
        level: "warn",
        type: `risk.${riskTrigger}`,
        message: `Global ${riskTrigger} triggered at ${price}`,
        metadata: { price }
      });
      return;
    }

    const fills = await this.adapter.listRecentFills(strategy.id, strategy.config.market);
    for (const fill of fills) {
      await this.handleFill(strategy, fill);
    }
    const now = new Date().toISOString();
    await this.store.upsertStrategy({ ...strategy, currentPrice: price, updatedAt: now, lastSyncedAt: now });
  }

  private async handleFill(strategy: StrategyRecord, fill: FillEvent): Promise<void> {
    const orders = buildReplenishmentOrders(strategy.config, fill);
    if (orders.length === 0) return;
    await this.adapter.placeOrders(orders, {
      dryRun: strategy.executionMode === "dry-run",
      allowLive: strategy.executionMode === "live" && this.appConfig.liveTradingEnabled
    });
    await writeAudit(this.store, {
      strategyId: strategy.id,
      level: "info",
      type: "grid.replenished",
      message: "Placed replenishment order after fill",
      metadata: { fill, orders }
    });
  }

  private async requireStrategy(id: string): Promise<StrategyRecord> {
    const strategy = await this.store.getStrategy(id);
    if (!strategy) throw new Error(`strategy not found: ${id}`);
    return strategy;
  }

  private async resolveCurrentPrice(
    market: string,
    productId: number | undefined,
    override: number | undefined,
    fallbackPrice: number
  ): Promise<number> {
    if (override && Number.isFinite(override) && override > 0) return override;
    try {
      const price = await this.adapter.getMarketPrice(market, productId);
      return price.markPrice;
    } catch {
      return fallbackPrice;
    }
  }
}

function midpoint(lower: number, upper: number): number {
  return (lower + upper) / 2;
}
