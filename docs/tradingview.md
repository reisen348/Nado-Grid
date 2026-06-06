# TradingView 接入

1. 将 `tv/nado_grid_range.pine` 添加到 TradingView Pine 编辑器。
2. 把指标添加到图表。
3. 从 Web 看板复制策略 ID，并粘贴到指标的 `策略 ID`。
4. 将 `.env` 中的 `TRADINGVIEW_WEBHOOK_SECRET` 粘贴到 `Webhook 密钥`。
5. 如果 TradingView 交易代码和 Nado 市场名不一致，在 `市场覆盖` 中填写 Nado 市场名，例如 `BTC-PERP`。
6. 拖动或输入上下边界价格。
7. 每次发送前修改 `Nonce`，打开 `发送`，并创建 `Any alert() function call` 类型的提醒。
8. Webhook 地址填写 `https://你的域名/api/tv/webhook`。

Webhook 只会更新网格区间。实盘启动仍然必须在 Web 看板中手动确认。
