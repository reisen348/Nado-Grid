import { existsSync } from "node:fs";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { MockDexAdapter, NadoDexAdapter } from "../../../packages/adapters/src/index.ts";
import type { DexAdapter } from "../../../packages/adapters/src/index.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import { verifySessionToken } from "./services/auth.ts";
import { StrategyService } from "./services/strategy-service.ts";
import { MemoryStrategyStore } from "./store/memory.ts";
import { SQLiteStrategyStore } from "./store/sqlite.ts";
import type { StrategyStore } from "./store/types.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerStrategyRoutes } from "./routes/strategies.ts";
import { registerTradingViewRoutes } from "./routes/tradingview.ts";
import { StrategyWorker } from "./workers/strategy-worker.ts";

export interface CreateAppOptions {
  config?: AppConfig;
  store?: StrategyStore;
  adapter?: DexAdapter;
  startWorker?: boolean;
}

export async function createApp(options: CreateAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = fastify({
    logger: config.nodeEnv !== "test"
  });
  const store = options.store ?? (config.nodeEnv === "test" ? new MemoryStrategyStore() : new SQLiteStrategyStore(config.dbPath));
  const adapter = options.adapter ?? createAdapter(config);
  const service = new StrategyService(store, adapter, config);
  const worker = new StrategyWorker(service);

  await app.register(cookie);
  await app.register(formbody);

  app.decorate("strategyStore", store);
  app.decorate("strategyWorker", worker);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/health") || request.url.startsWith("/api/auth/login") || request.url.startsWith("/api/tv/webhook")) return;
    if (!request.url.startsWith("/api/")) return;
    if (!verifySessionToken(request.cookies.grid_session, config.sessionSecret)) {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Login required" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error.message.includes("not found") ? 404 : error.message.includes("invalid") ? 400 : 500;
    reply.code(statusCode).send({
      error: {
        code: error.name || "error",
        message: error.message
      }
    });
  });

  app.get("/api/health", async () => ({
    ok: true,
    adapter: adapter.name,
    network: adapter.network,
    liveTradingEnabled: config.liveTradingEnabled
  }));

  await registerAuthRoutes(app, config);
  await registerStrategyRoutes(app, service, config);
  await registerTradingViewRoutes(app, service);

  const webDist = join(process.cwd(), "apps/web/dist");
  const hasWebBuild = existsSync(webDist);
  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      decorateReply: false
    });
  }
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "not_found", message: "API route not found" } });
    }
    if (hasWebBuild) return reply.sendFile("index.html");
    return reply.type("text/html").send("<!doctype html><title>Nado Grid</title><p>Build the web app with pnpm --filter @nado-grid/web build.</p>");
  });

  app.addHook("onClose", async () => {
    worker.stop();
    await store.close();
  });

  if (options.startWorker ?? config.nodeEnv !== "test") worker.start();
  return app;
}

function createAdapter(config: AppConfig): DexAdapter {
  if (config.useMockAdapter) return new MockDexAdapter({ network: config.nadoNetwork, defaultPrice: 100 });
  return new NadoDexAdapter({
    network: config.nadoNetwork,
    chainEnv: config.nadoChainEnv,
    privateKey: config.nadoPrivateKey,
    subaccount: config.nadoSubaccount,
    liveTradingEnabled: config.liveTradingEnabled
  });
}

declare module "fastify" {
  interface FastifyInstance {
    strategyStore: StrategyStore;
    strategyWorker: StrategyWorker;
  }
}
