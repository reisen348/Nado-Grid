import type { FastifyInstance } from "fastify";
import type { StrategyService } from "../services/strategy-service.ts";
import { parseStrategyCreateInput, parseStrategyStartInput, parseStrategyStopInput } from "../services/parser.ts";
import type { AppConfig } from "../config.ts";

export async function registerStrategyRoutes(app: FastifyInstance, service: StrategyService, config: AppConfig): Promise<void> {
  app.get("/api/strategies", async () => service.listStrategies());

  app.post("/api/strategies", async (request) => {
    const input = parseStrategyCreateInput(request.body, config.nadoNetwork);
    return service.createStrategy(input);
  });

  app.patch("/api/strategies/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseStrategyCreateInput(request.body, config.nadoNetwork);
    return service.updateStrategy(id, input);
  });

  app.get("/api/strategies/:id/status", async (request) => {
    const { id } = request.params as { id: string };
    return service.getStatus(id);
  });

  app.post("/api/strategies/:id/preview", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { currentPrice?: number } | undefined;
    return service.preview(id, body?.currentPrice);
  });

  app.post("/api/strategies/:id/sync", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { currentPrice?: number } | undefined;
    return service.syncStatus(id, body?.currentPrice);
  });

  app.post("/api/strategies/:id/start", async (request) => {
    const { id } = request.params as { id: string };
    return service.start(id, parseStrategyStartInput(request.body));
  });

  app.post("/api/strategies/:id/stop", async (request) => {
    const { id } = request.params as { id: string };
    return service.stop(id, parseStrategyStopInput(request.body));
  });
}
