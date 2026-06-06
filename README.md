# Nado Grid Tool

V1 Web grid tool for Nado perps with a Fastify API, React/Vite dashboard, SQLite state, TradingView webhook input, dry-run first execution, and a conservative adapter boundary for live trading.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The API listens on `http://localhost:8787`; the Vite app listens on `http://localhost:5173` and proxies `/api`.

## Packages

- `apps/api`: Fastify API, auth, SQLite store, TradingView webhook, strategy worker.
- `apps/web`: React/Vite operations dashboard.
- `packages/core`: grid math, risk checks, order planning, replenishment logic.
- `packages/adapters`: DEX adapter interface, mock adapter, Nado adapter boundary.
- `packages/shared`: shared API and strategy types.
- `tv/nado_grid_range.pine`: TradingView range indicator.

## Safety Defaults

- Trading defaults to `dry-run`.
- Live starts require `confirmPhrase: "START LIVE"`.
- Live trading is blocked unless `LIVE_TRADING_ENABLED=true`.
- TradingView webhook uses a separate secret and nonce idempotency.
