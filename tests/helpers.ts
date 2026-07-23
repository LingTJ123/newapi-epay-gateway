import pino from "pino";
import { createApp } from "../src/app.js";
import type { OrderRepository } from "../src/repositories/order-repository.js";
import type { AlipayClient } from "../src/services/alipay-client.js";
import type { NewapiNotifier, NewapiNotifyResult } from "../src/services/newapi-notify.js";
import { PaymentService } from "../src/services/payment-service.js";
import type {
  AlipayNotification,
  AlipayQueryResult,
  AppConfig,
  NewOrderInput,
  NotifyAttemptInput,
  OrderRecord,
  PaidOrderInput,
  StringParams
} from "../src/types.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: "test",
    port: 3100,
    logLevel: "silent",
    trustProxy: false,
    epayPid: "10001",
    epayKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    epayType: "alipay",
    minAmountCents: 1,
    maxAmountCents: 10_000,
    gatewayPublicUrl: "https://newapi.example.com/epay",
    newapiNotifyUrl: "https://newapi.example.com/api/user/epay/notify",
    newapiReturnUrl: "https://newapi.example.com/usage-logs",
    allowedNotifyUrl: "https://newapi.example.com/api/user/epay/notify",
    allowedReturnUrl: "https://newapi.example.com/usage-logs",
    alipayAppId: "2021000000000000",
    alipaySellerId: "2088000000000000",
    alipayGateway: "https://openapi.alipay.com/gateway.do",
    alipayKeyType: "PKCS8",
    alipayPrivateKeyPath: "unused",
    alipayAppCertPath: "unused",
    alipayPublicCertPath: "unused",
    alipayRootCertPath: "unused",
    notifyRetryEnabled: true,
    notifyRetryIntervalSeconds: 60,
    notifyRetryMaxCount: 20,
    pendingQueryIntervalSeconds: 120,
    orderExpireMinutes: 30,
    adminEnabled: false,
    adminUsername: "admin",
    adminPasswordHash: "",
    rateLimitEnabled: false,
    requestTimeoutMs: 2_000,
    ...overrides
  };
}

export class MemoryOrderRepository implements OrderRepository {
  private nextId = 1n;
  readonly orders = new Map<string, OrderRecord>();
  readonly attempts: NotifyAttemptInput[] = [];

  async createOrGet(input: NewOrderInput) {
    const existing = this.orders.get(input.outTradeNo);
    if (existing) return { order: existing, created: false };
    const now = new Date();
    const order: OrderRecord = {
      ...input,
      id: this.nextId++,
      currency: "CNY",
      status: "WAIT_PAY",
      alipayTradeNo: null,
      alipayBuyerId: null,
      alipayBuyerLogonIdMasked: null,
      alipayTradeStatus: null,
      paidAt: null,
      lastQueriedAt: null,
      newapiNotifiedAt: null,
      newapiNotifyStatus: "PENDING",
      newapiNotifyAttempts: 0,
      newapiNotifyLastError: null,
      newapiNotifyNextAt: null,
      newapiNotifyLockedAt: null,
      version: 0,
      createdAt: now,
      updatedAt: now
    };
    this.orders.set(input.outTradeNo, order);
    return { order, created: true };
  }

  async findByOutTradeNo(outTradeNo: string) { return this.orders.get(outTradeNo) ?? null; }
  async findByTradeNo(tradeNo: string) {
    return [...this.orders.values()].find((order) => order.alipayTradeNo === tradeNo) ?? null;
  }
  async markPaid(order: OrderRecord, input: PaidOrderInput) {
    if (order.alipayTradeNo && order.alipayTradeNo !== input.alipayTradeNo) throw new Error("交易号冲突");
    if (order.status === "COMPLETED") return order;
    if (order.status === "PAID" && order.alipayTradeNo === input.alipayTradeNo) return order;
    Object.assign(order, {
      status: "PAID",
      alipayTradeNo: input.alipayTradeNo,
      alipayBuyerId: input.buyerId,
      alipayBuyerLogonIdMasked: input.buyerLogonIdMasked,
      alipayTradeStatus: input.tradeStatus,
      paidAt: input.paidAt,
      newapiNotifyStatus: "PENDING",
      newapiNotifyNextAt: new Date(),
      version: order.version + 1
    });
    return order;
  }
  async claimNotification(orderId: bigint, maxAttempts: number) {
    const order = [...this.orders.values()].find((item) => item.id === orderId);
    if (!order || order.status !== "PAID" || order.newapiNotifyStatus === "PROCESSING" || order.newapiNotifyStatus === "SUCCESS" || order.newapiNotifyAttempts >= maxAttempts) return null;
    order.newapiNotifyStatus = "PROCESSING";
    order.newapiNotifyAttempts += 1;
    order.newapiNotifyLockedAt = new Date();
    return order;
  }
  async completeNotification(orderId: bigint) {
    const order = this.byId(orderId);
    order.status = "COMPLETED";
    order.newapiNotifyStatus = "SUCCESS";
    order.newapiNotifiedAt = new Date();
    order.newapiNotifyLockedAt = null;
    return order;
  }
  async failNotification(orderId: bigint, error: string, nextAttemptAt: Date) {
    const order = this.byId(orderId);
    order.newapiNotifyStatus = "FAILED";
    order.newapiNotifyLastError = error;
    order.newapiNotifyNextAt = nextAttemptAt;
    order.newapiNotifyLockedAt = null;
    return order;
  }
  async recordNotifyAttempt(_orderId: bigint, input: NotifyAttemptInput) { this.attempts.push(input); }
  async findNotificationsDue(limit: number, maxAttempts: number) {
    const staleLock = Date.now() - 2 * 60_000;
    return [...this.orders.values()].filter((order) => order.status === "PAID" && order.newapiNotifyAttempts < maxAttempts && (
      ["PENDING", "FAILED"].includes(order.newapiNotifyStatus) ||
      (order.newapiNotifyStatus === "PROCESSING" && (!order.newapiNotifyLockedAt || order.newapiNotifyLockedAt.getTime() <= staleLock))
    )).slice(0, limit);
  }
  async findPendingOrders(limit: number, _queriedBefore: Date) {
    return [...this.orders.values()].filter((order) => order.status === "WAIT_PAY").slice(0, limit);
  }
  async touchQueried(orderId: bigint) { this.byId(orderId).lastQueriedAt = new Date(); }
  async closeOrder(orderId: bigint, _reason: string) { this.byId(orderId).status = "CLOSED"; }
  async listOrders(limit: number, query?: string) {
    return [...this.orders.values()].filter((order) => !query || order.outTradeNo.includes(query)).slice(0, limit);
  }
  async ping() {}

  private byId(id: bigint) {
    const order = [...this.orders.values()].find((item) => item.id === id);
    if (!order) throw new Error("订单不存在");
    return order;
  }
}

export class FakeAlipayClient implements AlipayClient {
  paymentHtmlCalls = 0;
  validSignature = true;
  queryResult: AlipayQueryResult = {
    found: false, success: false, closed: false, outTradeNo: "", tradeNo: null,
    tradeStatus: null, totalAmount: null, buyerId: null, buyerLogonId: null
  };
  async createPaymentHtml(order: OrderRecord) {
    this.paymentHtmlCalls += 1;
    return `<form data-order="${order.outTradeNo}"></form>`;
  }
  verifyNotification(_params: StringParams) { return this.validSignature; }
  parseNotification(params: StringParams): AlipayNotification {
    return {
      appId: params.app_id ?? "",
      sellerId: params.seller_id ?? "",
      outTradeNo: params.out_trade_no ?? "",
      tradeNo: params.trade_no ?? "",
      tradeStatus: params.trade_status ?? "",
      totalAmount: params.total_amount ?? "",
      buyerId: params.buyer_id ?? null,
      buyerLogonId: params.buyer_logon_id ?? null,
      gmtPayment: params.gmt_payment ?? null
    };
  }
  async queryOrder(_order: OrderRecord) { return this.queryResult; }
  async closeOrder(_order: OrderRecord) {}
}

export class FakeNotifier implements NewapiNotifier {
  calls = 0;
  readonly results: NewapiNotifyResult[];
  constructor(results?: NewapiNotifyResult[]) {
    this.results = results ?? [{
      httpStatus: 200, responseSummary: "success", errorType: null,
      durationMs: 1, succeeded: true, errorMessage: null
    }];
  }
  async notify(_order: OrderRecord) {
    const index = Math.min(this.calls++, this.results.length - 1);
    const result = this.results[index];
    if (!result) throw new Error("缺少测试通知结果");
    return result;
  }
}

export function testApplication(options: { notifier?: FakeNotifier; config?: AppConfig } = {}) {
  const config = options.config ?? testConfig();
  const repository = new MemoryOrderRepository();
  const alipay = new FakeAlipayClient();
  const notifier = options.notifier ?? new FakeNotifier();
  const logger = pino({ level: "silent" });
  const paymentService = new PaymentService(config, repository, alipay, notifier, logger);
  const app = createApp({ config, repository, alipay, paymentService, logger });
  return { app, config, repository, alipay, notifier, paymentService };
}
