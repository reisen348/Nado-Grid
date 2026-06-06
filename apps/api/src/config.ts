import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import type { NadoNetwork } from "../../../packages/shared/src/index.ts";

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  adminPassword: string;
  sessionSecret: string;
  tradingViewWebhookSecret: string;
  dbPath: string;
  nadoNetwork: NadoNetwork;
  nadoChainEnv: string;
  nadoPrivateKey?: string;
  nadoSubaccount: string;
  liveTradingEnabled: boolean;
  useMockAdapter: boolean;
}

let defaultEnvLoaded = false;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env && !defaultEnvLoaded) {
    defaultEnvLoaded = true;
    loadLocalEnvFile();
  }

  const nodeEnv = env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    host: env.HOST ?? "0.0.0.0",
    port: parseInteger(env.PORT, 8787),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "http://localhost:8787",
    adminPassword: required(env.ADMIN_PASSWORD, "ADMIN_PASSWORD", nodeEnv === "test" ? "test-password" : undefined),
    sessionSecret: required(env.SESSION_SECRET, "SESSION_SECRET", nodeEnv === "test" ? "test-session-secret" : undefined),
    tradingViewWebhookSecret: required(
      env.TRADINGVIEW_WEBHOOK_SECRET,
      "TRADINGVIEW_WEBHOOK_SECRET",
      nodeEnv === "test" ? "test-tv-secret" : undefined
    ),
    dbPath: resolve(env.DB_PATH ?? "./data/nado-grid.sqlite"),
    nadoNetwork: parseNetwork(env.NADO_NETWORK),
    nadoChainEnv: env.NADO_CHAIN_ENV ?? (parseNetwork(env.NADO_NETWORK) === "testnet" ? "inkTestnet" : "ink"),
    nadoPrivateKey: env.NADO_PRIVATE_KEY || undefined,
    nadoSubaccount: env.NADO_SUBACCOUNT ?? "default",
    liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    useMockAdapter: env.USE_MOCK_ADAPTER === "true" || nodeEnv === "test"
  };
}

function loadLocalEnvFile(): void {
  for (const path of [".env", "../../.env"]) {
    try {
      loadEnvFile(path);
      return;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "ENOENT") throw error;
    }
  }
}

function required(value: string | undefined, name: string, fallback?: string): string {
  if (value) return value;
  if (fallback) return fallback;
  throw new Error(`${name} is required`);
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNetwork(value: string | undefined): NadoNetwork {
  return value === "testnet" ? "testnet" : "mainnet";
}
