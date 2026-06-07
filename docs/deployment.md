# VPS Deployment

## Build

```bash
pnpm install
pnpm build
```

## Configure

Copy `.env.example` to `.env` on the VPS and set at least:

```bash
ADMIN_PASSWORD=...
SESSION_SECRET=...
TRADINGVIEW_WEBHOOK_SECRET=...
DB_PATH=/opt/nado-grid/data/nado-grid.sqlite
NADO_NETWORK=mainnet
NADO_CHAIN_ENV=inkMainnet
LIVE_TRADING_ENABLED=false
```

Keep `LIVE_TRADING_ENABLED=false` until mainnet dry-run has been checked end to end.

## Run

```bash
pnpm --filter @nado-grid/api start
```

For systemd, install `deploy/nado-grid.service` as `/etc/systemd/system/nado-grid.service`, adjust paths, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nado-grid
```

Put nginx or Caddy in front with HTTPS. `deploy/nginx.conf` is a minimal reverse proxy example.
