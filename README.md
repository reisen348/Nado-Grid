# Nado Grid 工具

Nado 永续合约网格工具 V1。项目包含 Fastify API、React/Vite 操作看板、SQLite 状态存储、TradingView webhook 接入、默认模拟执行，以及用于实盘交易的保守适配器边界。

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm dev
```

API 默认监听 `http://localhost:8787`；Vite 看板默认监听 `http://localhost:5173`，并将 `/api` 代理到后端。

## 目录结构

- `apps/api`：Fastify API、登录鉴权、SQLite 存储、TradingView webhook、策略 worker。
- `apps/web`：React/Vite 操作看板，包含策略配置、预览、执行控制和 TradingView 图表。
- `packages/core`：网格计算、风险检查、订单规划和补单逻辑。
- `packages/adapters`：DEX 适配器接口、模拟适配器和 Nado 适配器边界。
- `packages/shared`：前后端共享的 API 与策略类型。
- `tv/nado_grid_range.pine`：TradingView 网格区间指标脚本。

## 安全默认值

- 交易默认使用 `dry-run` 模式。
- 实盘启动必须传入 `confirmPhrase: "START LIVE"`。
- 除非设置 `LIVE_TRADING_ENABLED=true`，否则实盘交易会被阻止。
- TradingView webhook 使用独立密钥，并通过 `nonce` 做幂等控制。

## 观察与模拟流程

当前看板优先用于自己观察、dry-run 和半自动辅助，不建议直接无人值守实盘运行。

1. 在 `策略配置` 中保存网格参数。
2. 选中策略后，看板会自动回填配置和最近价格；再次保存会更新当前策略，不会新建重复策略。
3. 打开 `自动同步 Nado API` 后，看板每 5 秒同步一次策略状态和市场价；也可以点击顶部 `同步` 手动刷新。
4. TradingView 图表下方的 Nado API 状态条会显示同步状态、当前价格、上下沿和网格线位置。
5. 使用 `观察辅助` 查看当前建议、区间位置、下一入场、配对止盈、止盈止损距离。
6. 填写并保存 Nado `产品 ID` 后，点击 `当前建议` 里的 `拉取5m K线`，看板会读取 Nado 实盘 5 分钟 K 线并重算方向、网格区间、止盈价、止损价。
7. 确认建议后点击 `套用建议`，可将方向、当前价、区间、止盈和止损写回配置表单。
8. 使用 `市场价`、`下沿`、`中线`、`上沿` 快速刷新不同价格场景的预览。
9. 执行模式保持 `模拟`，点击 `启动` 只做 dry-run 下单和审计记录。
10. 结合 TradingView 图表确认价格行为后，再手动决定是否调整区间或停止策略。

`当前建议` 不依赖 LLM API。它是确定性规则：有 Nado K 线时，区间取最近 K 线前低/前高，价格在区间上半部时偏空、下半部时偏多，止损放前高/前低外侧，止盈优先取目标方向的失衡区；没有 K 线或未填写产品 ID 时，才回退到当前网格上下沿近似计算。

## API 操作

- `PATCH /api/strategies/:id`：更新现有网格参数。
- `POST /api/strategies/:id/sync`：同步 Nado API 市场价并返回最新策略状态。
- `POST /api/strategies/:id/preview`：按指定价格生成 dry-run 预览。
- `POST /api/strategies/:id/start`：按当前参数启动 dry-run 或显式确认后的实盘模式。
- `POST /api/strategies/:id/stop`：停止策略并尝试撤单/平仓。

## TradingView 接入

1. 在 TradingView Pine 编辑器中添加 `tv/nado_grid_range.pine`。
2. 将指标添加到图表。
3. 在指标的 `策略 ID` 中填写看板里的策略 ID。
4. 在 `Webhook 密钥` 中填写 `.env` 里的 `TRADINGVIEW_WEBHOOK_SECRET`。
5. 如果 TradingView 交易代码和 Nado 市场名不一致，在 `市场覆盖` 中填写 Nado 市场名，例如 `BTC-PERP`。
6. 调整上下边界价格，修改 `Nonce`，打开 `发送`，并创建 `Any alert() function call` 类型的提醒。
7. Webhook 地址使用 `https://你的域名/api/tv/webhook`。

Webhook 只更新网格区间；实盘启动仍然需要在看板里手动确认。
