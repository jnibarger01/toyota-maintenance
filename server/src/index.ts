import { buildApp } from "./app.js";

const dbPath = process.env.TMC_DB ?? "tmc.db";
const port = Number(process.env.TMC_PORT ?? 8791);
const host = process.env.TMC_HOST ?? "127.0.0.1";

const app = buildApp({ dbPath, logger: true });

app.listen({ port, host }).then(() => {
  app.log.info(`maintenance cockpit API on http://${host}:${port} (db=${dbPath}, read-only)`);
}).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
