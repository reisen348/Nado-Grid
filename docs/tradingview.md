# TradingView Setup

1. Add `tv/nado_grid_range.pine` to Pine Editor.
2. Add the indicator to the chart.
3. Paste the strategy ID from the Web panel.
4. Paste `TRADINGVIEW_WEBHOOK_SECRET`.
5. Drag the upper and lower price inputs on the chart.
6. Change `Nonce`, toggle `Send`, and create an alert using `Any alert() function call`.
7. Set the webhook URL to `https://your-domain.example/api/tv/webhook`.

The webhook updates only the grid range. Live trading still requires confirmation in the Web panel.
