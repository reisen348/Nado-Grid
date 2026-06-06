import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.ts";
import { createSessionToken, verifyPassword } from "../services/auth.ts";

export async function registerAuthRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { password?: string } | undefined;
    if (!verifyPassword(body?.password, config.adminPassword)) {
      return reply.code(401).send({ error: { code: "invalid_password", message: "Invalid password" } });
    }
    reply.setCookie("grid_session", createSessionToken(config.sessionSecret), {
      httpOnly: true,
      sameSite: "lax",
      secure: config.nodeEnv === "production",
      path: "/"
    });
    return { ok: true };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("grid_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async () => ({ authenticated: true }));
}
