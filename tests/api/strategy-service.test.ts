import test from "node:test";
import assert from "node:assert/strict";
import { MockDexAdapter } from "../../packages/adapters/src/mock.ts";
import type { AppConfig } from "../../apps/api/src/config.ts";
import { StrategyService } from "../../apps/api/src/services/strategy-service.ts";
import { MemoryStrategyStore } from "../../apps/api/src/store/memory.ts";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 8787,
  publicBaseUrl: "http://localhost:8787",
  adminPassword: "test-password",
  sessionSecret: "test-session-secret",
  tradingViewWebhookSecret: "tv-secret",
  dbPath: ":memory:",
  nadoNetwork: "mainnet",
  nadoChainEnv: "ink",
  nadoPrivateKey: undefined,
  nadoSubaccount: "default",
  liveTradingEnabled: false,
  useMockAdapter: true
};

test("strategy service creates, previews, starts dry-run, and stops", async () => {
  const store = new MemoryStrategyStore();
  const adapter = new MockDexAdapter({ defaultPrice: 100_000 });
  const service = new StrategyService(store, adapter, config);

  const created = await service.createStrategy({
    currentPrice: 100_000,
    config: {
      market: "BTC-PERP",
      direction: "long",
      lowerPrice: 90_000,
      upperPrice: 110_000,
      gridCount: 10,
      marginPerGrid: 10,
      leverage: 3,
      takeProfitPrice: 112_000,
      stopLossPrice: 88_000,
      postOnly: true,
      network: "mainnet"
    }
  });

  assert.equal(created.strategy.status, "ready");
  assert.equal(created.preview.orders.length, 5);

  const started = await service.start(created.strategy.id, { executionMode: "dry-run" });
  assert.equal(started.strategy.status, "running");

  const stopped = await service.stop(created.strategy.id, { closePosition: true, reason: "manual" });
  assert.equal(stopped.status, "stopped");
});

test("TradingView webhook reserves nonce and updates range once", async () => {
  const store = new MemoryStrategyStore();
  const adapter = new MockDexAdapter({ defaultPrice: 100_000 });
  const service = new StrategyService(store, adapter, config);
  const created = await service.createStrategy({
    currentPrice: 100_000,
    config: {
      market: "BTC-PERP",
      direction: "long",
      lowerPrice: 90_000,
      upperPrice: 110_000,
      gridCount: 10,
      marginPerGrid: 10,
      leverage: 3,
      takeProfitPrice: 112_000,
      stopLossPrice: 88_000,
      postOnly: true,
      network: "mainnet"
    }
  });

  const payload = {
    strategyId: created.strategy.id,
    nonce: "nonce-1",
    symbol: "BTC-PERP",
    upper: 108_000,
    lower: 92_000,
    timestamp: Date.now(),
    secret: "tv-secret"
  };

  const first = await service.applyTradingViewWebhook(payload);
  assert.equal(first.duplicate, false);
  assert.equal(first.strategy.config.market, "BTC-PERP");

  const second = await service.applyTradingViewWebhook(payload);
  assert.equal(second.duplicate, true);
});
