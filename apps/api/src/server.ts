import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = await createApp({ config });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
