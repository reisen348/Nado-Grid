import type { FastifyInstance } from "fastify";
import type { StrategyService } from "../services/strategy-service.ts";
import { parseTradingViewPayload } from "../services/parser.ts";

export async function registerTradingViewRoutes(app: FastifyInstance, service: StrategyService): Promise<void> {
  app.post("/api/tv/webhook", async (request) => {
    const payload = parseTradingViewPayload(request.body);
    return service.applyTradingViewWebhook(payload);
  });
}
