import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGridLevels,
  buildInitialOrders,
  buildPreview,
  buildReplenishmentOrders,
  shouldTriggerGlobalRisk,
  validateGridConfig
} from "../../packages/core/src/index.ts";
import type { FillEvent, GridConfig } from "../../packages/shared/src/index.ts";

const longConfig: GridConfig = {
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
};

test("buildGridLevels creates arithmetic inclusive levels", () => {
  const levels = buildGridLevels(longConfig);
  assert.equal(levels.length, 11);
  assert.equal(levels[0]?.price, 90_000);
  assert.equal(levels[5]?.price, 100_000);
  assert.equal(levels[10]?.price, 110_000);
});

test("long grid places entry buys below current price", () => {
  const orders = buildInitialOrders("grid_test", longConfig, 100_000);
  assert.equal(orders.length, 5);
  assert.ok(orders.every((order) => order.side === "buy"));
  assert.ok(orders.every((order) => order.postOnly));
  assert.equal(orders[0]?.notional, 30);
});

test("short grid places entry sells above current price", () => {
  const config: GridConfig = {
    ...longConfig,
    direction: "short",
    takeProfitPrice: 88_000,
    stopLossPrice: 112_000
  };
  const orders = buildInitialOrders("grid_test", config, 100_000);
  assert.equal(orders.length, 5);
  assert.ok(orders.every((order) => order.side === "sell"));
});

test("preview exposes margin and notional risk", () => {
  const preview = buildPreview("grid_test", longConfig, 100_000);
  assert.equal(preview.risk.activeEntryOrders, 5);
  assert.equal(preview.risk.marginAtRisk, 50);
  assert.equal(preview.risk.maxNotionalExposure, 150);
});

test("risk validation follows direction", () => {
  assert.deepEqual(validateGridConfig(longConfig, 100_000), []);
  assert.ok(validateGridConfig({ ...longConfig, stopLossPrice: 101_000 }, 100_000).length > 0);
});

test("entry fill creates reduce-only take-profit order", () => {
  const entry = buildInitialOrders("grid_test", longConfig, 100_000)[0]!;
  const fill: FillEvent = {
    strategyId: entry.strategyId,
    clientOrderId: entry.clientOrderId,
    market: entry.market,
    side: entry.side,
    price: entry.price,
    amountBase: entry.amountBase,
    reduceOnly: entry.reduceOnly,
    gridIndex: entry.gridIndex,
    pairedGridIndex: entry.pairedGridIndex,
    filledAt: new Date().toISOString()
  };
  const replenishment = buildReplenishmentOrders(longConfig, fill);
  assert.equal(replenishment.length, 1);
  assert.equal(replenishment[0]?.side, "sell");
  assert.equal(replenishment[0]?.reduceOnly, true);
});

test("global risk trigger maps TP and SL", () => {
  assert.equal(shouldTriggerGlobalRisk(longConfig, 112_500), "take-profit");
  assert.equal(shouldTriggerGlobalRisk(longConfig, 87_500), "stop-loss");
  assert.equal(shouldTriggerGlobalRisk(longConfig, 100_000), undefined);
});
