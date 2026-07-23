export type OrderStatus = "WAIT_PAY" | "PAID" | "COMPLETED" | "CLOSED" | "REFUNDED" | "FAILED";
export type NotifyStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";

export interface OrderRecord {
  id: bigint;
  outTradeNo: string;
  epayPid: string;
  payType: string;
  subject: string;
  amountCents: number;
  currency: string;
  newapiNotifyUrl: string;
  newapiReturnUrl: string;
  clientParam: string | null;
  status: OrderStatus;
  alipayTradeNo: string | null;
  alipayBuyerId: string | null;
  alipayBuyerLogonIdMasked: string | null;
  alipayTradeStatus: string | null;
  paidAt: Date | null;
  expiredAt: Date;
  lastQueriedAt: Date | null;
  newapiNotifiedAt: Date | null;
  newapiNotifyStatus: NotifyStatus;
  newapiNotifyAttempts: number;
  newapiNotifyLastError: string | null;
  newapiNotifyNextAt: Date | null;
  newapiNotifyLockedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrderInput {
  outTradeNo: string;
  epayPid: string;
  payType: string;
  subject: string;
  amountCents: number;
  newapiNotifyUrl: string;
  newapiReturnUrl: string;
  clientParam: string | null;
  expiredAt: Date;
}

export interface PaidOrderInput {
  alipayTradeNo: string;
  buyerId: string | null;
  buyerLogonIdMasked: string | null;
  tradeStatus: string;
  paidAt: Date;
}

export interface NotifyAttemptInput {
  httpStatus: number | null;
  responseSummary: string | null;
  errorType: string | null;
  durationMs: number;
  succeeded: boolean;
}

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: string;
  trustProxy: boolean;
  epayPid: string;
  epayKey: string;
  epayType: "alipay";
  minAmountCents: number;
  maxAmountCents: number;
  gatewayPublicUrl: string;
  newapiNotifyUrl: string;
  newapiReturnUrl: string;
  allowedNotifyUrl: string;
  allowedReturnUrl: string;
  alipayAppId: string;
  alipaySellerId: string;
  alipayGateway: string;
  alipayKeyType: "PKCS8";
  alipayPrivateKeyPath: string;
  alipayAppCertPath: string;
  alipayPublicCertPath: string;
  alipayRootCertPath: string;
  notifyRetryEnabled: boolean;
  notifyRetryIntervalSeconds: number;
  notifyRetryMaxCount: number;
  pendingQueryIntervalSeconds: number;
  orderExpireMinutes: number;
  adminEnabled: boolean;
  adminUsername: string;
  adminPasswordHash: string;
  rateLimitEnabled: boolean;
  requestTimeoutMs: number;
}

export type StringParams = Record<string, string>;

export interface AlipayNotification {
  appId: string;
  sellerId: string;
  outTradeNo: string;
  tradeNo: string;
  tradeStatus: string;
  totalAmount: string;
  buyerId: string | null;
  buyerLogonId: string | null;
  gmtPayment: string | null;
}

export interface AlipayQueryResult {
  found: boolean;
  success: boolean;
  closed: boolean;
  outTradeNo: string;
  tradeNo: string | null;
  tradeStatus: string | null;
  totalAmount: string | null;
  buyerId: string | null;
  buyerLogonId: string | null;
}
