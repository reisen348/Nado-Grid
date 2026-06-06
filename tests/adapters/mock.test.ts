import test from "node:test";
import assert from "node:assert/strict";
import { MockDexAdapter } from "../../packages/adapters/src/mock.ts";
import type { PlannedOrder } from "../../packages/shared/src/index.ts";

test("mock adapter places and cancels dry-run orders", async () => {
  const adapter = new MockDexAdapter({ defaultPrice: 100 });
  const order: PlannedOrder = {
    clientOrderId: "grid_test:entry:1:buy:100000000",
    strategyId: "grid_test",
    market: "BTC-PERP",
    productId: 2,
    side: "buy",
    price: 100,
    amountBase: 0.3,
    notional: 30,
    margin: 10,
    reduceOnly: false,
    postOnly: true,
    intent: "entry",
    gridIndex: 1,
    pairedGridIndex: 2
  };

  const result = await adapter.placeOrders([order], { dryRun: true, allowLive: false });
  assert.equal(result[0]?.status, "open");
  assert.equal(result[0]?.clientOrderId, order.clientOrderId);

  const fill = adapter.simulateFill(order);
  assert.equal(fill.strategyId, "grid_test");
  assert.equal((await adapter.listRecentFills("grid_test", "BTC-PERP")).length, 1);

  await adapter.cancelStrategyOrders("grid_test", "BTC-PERP");
});
