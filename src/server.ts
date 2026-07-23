import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { startJobs } from "./jobs.js";
import { PrismaOrderRepository } from "./repositories/order-repository.js";
import { OfficialAlipayClient } from "./services/alipay-client.js";
import { HttpNewapiNotifier } from "./services/newapi-notify.js";
import { PaymentService } from "./services/payment-service.js";

const config = loadConfig();
const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ["epayKey", "password", "privateKey", "DATABASE_URL", "req.headers.authorization", "req.body.sign", "req.body.key"],
    censor: "[REDACTED]"
  }
});
const prisma = new PrismaClient({ log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"] });
const repository = new PrismaOrderRepository(prisma);
const alipay = new OfficialAlipayClient(config);
const notifier = new HttpNewapiNotifier(config);
const paymentService = new PaymentService(config, repository, alipay, notifier, logger);
const app = createApp({ config, repository, alipay, paymentService, logger });

await repository.ping();
const server = app.listen(config.port, "0.0.0.0", () => {
  logger.info({ port: config.port }, "NewAPI EPay 网关已启动");
});
const stopJobs = startJobs(config, repository, alipay, paymentService, logger);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "正在安全停止服务");
  stopJobs();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
