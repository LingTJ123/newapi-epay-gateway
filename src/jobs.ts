import type { Logger } from "pino";
import type { OrderRepository } from "./repositories/order-repository.js";
import type { AlipayClient } from "./services/alipay-client.js";
import type { PaymentService } from "./services/payment-service.js";
import type { AppConfig } from "./types.js";

export function startJobs(
  config: AppConfig,
  repository: OrderRepository,
  alipay: AlipayClient,
  paymentService: PaymentService,
  logger: Logger
): () => void {
  const timers: NodeJS.Timeout[] = [];
  let retryRunning = false;
  let queryRunning = false;

  const retry = async () => {
    if (retryRunning || !config.notifyRetryEnabled) return;
    retryRunning = true;
    try {
      const orders = await repository.findNotificationsDue(50, config.notifyRetryMaxCount);
      for (const order of orders) await paymentService.notifyNewapi(order);
    } catch (error) {
      logger.error({ err: error }, "执行 NewAPI 回调重试任务失败");
    } finally {
      retryRunning = false;
    }
  };

  const query = async () => {
    if (queryRunning) return;
    queryRunning = true;
    try {
      const queriedBefore = new Date(Date.now() - config.pendingQueryIntervalSeconds * 1000);
      const orders = await repository.findPendingOrders(50, queriedBefore);
      for (const order of orders) {
        try {
          const reconciled = await paymentService.queryAndReconcile(order);
          if (reconciled.status === "WAIT_PAY" && order.expiredAt <= new Date()) {
            await alipay.closeOrder(order);
            await repository.closeOrder(order.id, "订单超过支付有效期");
          }
        } catch (error) {
          logger.warn({ err: error, outTradeNo: order.outTradeNo }, "支付宝查单或关单失败");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "执行支付宝主动查单任务失败");
    } finally {
      queryRunning = false;
    }
  };

  timers.push(setInterval(() => void retry(), config.notifyRetryIntervalSeconds * 1000));
  timers.push(setInterval(() => void query(), config.pendingQueryIntervalSeconds * 1000));
  for (const timer of timers) timer.unref();
  void retry();
  void query();
  return () => timers.forEach(clearInterval);
}
