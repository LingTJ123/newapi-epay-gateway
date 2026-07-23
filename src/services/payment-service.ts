import type { Logger } from "pino";
import type { OrderRepository } from "../repositories/order-repository.js";
import type { AlipayNotification, AppConfig, OrderRecord } from "../types.js";
import { parseMoneyToCents } from "../utils/money.js";
import { maskAccount } from "../utils/security.js";
import type { AlipayClient } from "./alipay-client.js";
import type { NewapiNotifier } from "./newapi-notify.js";

const RETRY_DELAYS_MINUTES = [1, 2, 5, 10, 30, 60];

export class PaymentService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: OrderRepository,
    private readonly alipay: AlipayClient,
    private readonly notifier: NewapiNotifier,
    private readonly logger: Logger
  ) {}

  validateAlipayPayment(order: OrderRecord, notification: AlipayNotification): void {
    if (notification.appId !== this.config.alipayAppId) throw new Error("支付宝 app_id 不匹配");
    if (notification.sellerId !== this.config.alipaySellerId) throw new Error("支付宝 seller_id 不匹配");
    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(notification.tradeStatus)) {
      throw new Error("支付宝交易状态不是成功状态");
    }
    if (!notification.tradeNo || !/^\d{16,64}$/.test(notification.tradeNo)) throw new Error("支付宝交易号无效");
    if (parseMoneyToCents(notification.totalAmount) !== order.amountCents) throw new Error("支付宝通知金额不匹配");
  }

  async acceptPaidOrder(order: OrderRecord, notification: AlipayNotification): Promise<OrderRecord> {
    this.validateAlipayPayment(order, notification);
    const paidAt = notification.gmtPayment && !Number.isNaN(Date.parse(notification.gmtPayment))
      ? new Date(notification.gmtPayment)
      : new Date();
    return await this.repository.markPaid(order, {
      alipayTradeNo: notification.tradeNo,
      buyerId: notification.buyerId,
      buyerLogonIdMasked: maskAccount(notification.buyerLogonId),
      tradeStatus: notification.tradeStatus,
      paidAt
    });
  }

  async notifyNewapi(order: OrderRecord): Promise<boolean> {
    if (order.newapiNotifyStatus === "SUCCESS" || order.status === "COMPLETED") return true;
    const claimed = await this.repository.claimNotification(order.id, this.config.notifyRetryMaxCount);
    if (!claimed) {
      const current = await this.repository.findByOutTradeNo(order.outTradeNo);
      return current?.newapiNotifyStatus === "SUCCESS";
    }

    const result = await this.notifier.notify(claimed);
    await this.repository.recordNotifyAttempt(claimed.id, result);
    if (result.succeeded) {
      await this.repository.completeNotification(claimed.id);
      this.logger.info({ outTradeNo: claimed.outTradeNo }, "NewAPI 回调成功");
      return true;
    }

    const delayIndex = Math.min(Math.max(claimed.newapiNotifyAttempts - 1, 0), RETRY_DELAYS_MINUTES.length - 1);
    const delay = RETRY_DELAYS_MINUTES[delayIndex] ?? 60;
    await this.repository.failNotification(
      claimed.id,
      result.errorMessage ?? "NewAPI 回调失败",
      new Date(Date.now() + delay * 60_000)
    );
    this.logger.warn({ outTradeNo: claimed.outTradeNo, error: result.errorMessage }, "NewAPI 回调失败，已安排重试");
    return false;
  }

  async queryAndReconcile(order: OrderRecord): Promise<OrderRecord> {
    const result = await this.alipay.queryOrder(order);
    await this.repository.touchQueried(order.id);
    if (result.closed) {
      await this.repository.closeOrder(order.id, "支付宝订单已关闭");
      return (await this.repository.findByOutTradeNo(order.outTradeNo)) ?? order;
    }
    if (!result.success) return order;
    if (result.outTradeNo !== order.outTradeNo || !result.tradeNo || !result.tradeStatus || !result.totalAmount) {
      throw new Error("支付宝查单结果字段不完整或订单号不匹配");
    }
    const paid = await this.acceptPaidOrder(order, {
      appId: this.config.alipayAppId,
      sellerId: this.config.alipaySellerId,
      outTradeNo: result.outTradeNo,
      tradeNo: result.tradeNo,
      tradeStatus: result.tradeStatus,
      totalAmount: result.totalAmount,
      buyerId: result.buyerId,
      buyerLogonId: result.buyerLogonId,
      gmtPayment: null
    });
    await this.notifyNewapi(paid);
    return (await this.repository.findByOutTradeNo(order.outTradeNo)) ?? paid;
  }
}
