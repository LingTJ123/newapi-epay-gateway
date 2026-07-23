import { accessSync, constants } from "node:fs";
import { z } from "zod";
import { parseMoneyToCents } from "./utils/money.js";
import type { AppConfig } from "./types.js";

const booleanValue = z.string().transform((value, ctx) => {
  if (value === "true") return true;
  if (value === "false") return false;
  ctx.addIssue({ code: "custom", message: "必须为 true 或 false" });
  return z.NEVER;
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.string().default("info"),
  TRUST_PROXY: booleanValue.default(true),
  EPAY_PID: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  EPAY_KEY: z.string().min(32),
  EPAY_TYPE: z.literal("alipay").default("alipay"),
  MIN_AMOUNT: z.string().default("0.01"),
  MAX_AMOUNT: z.string().default("100.00"),
  GATEWAY_PUBLIC_URL: z.url().startsWith("https://"),
  NEWAPI_NOTIFY_URL: z.url().startsWith("https://"),
  NEWAPI_RETURN_URL: z.url().startsWith("https://"),
  ALLOWED_NEWAPI_NOTIFY_URL: z.url().startsWith("https://"),
  ALLOWED_NEWAPI_RETURN_URL: z.url().startsWith("https://"),
  ALIPAY_APP_ID: z.string().regex(/^\d{10,32}$/),
  ALIPAY_SELLER_ID: z.string().regex(/^2088\d{12,20}$/),
  ALIPAY_GATEWAY: z.url().startsWith("https://").default("https://openapi.alipay.com/gateway.do"),
  ALIPAY_KEY_TYPE: z.literal("PKCS8").default("PKCS8"),
  ALIPAY_PRIVATE_KEY_PATH: z.string().min(1),
  ALIPAY_APP_CERT_PATH: z.string().min(1),
  ALIPAY_PUBLIC_CERT_PATH: z.string().min(1),
  ALIPAY_ROOT_CERT_PATH: z.string().min(1),
  DATABASE_URL: z.string().startsWith("mysql://"),
  NOTIFY_RETRY_ENABLED: booleanValue.default(true),
  NOTIFY_RETRY_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  NOTIFY_RETRY_MAX_COUNT: z.coerce.number().int().min(1).max(100).default(20),
  PENDING_QUERY_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(120),
  ORDER_EXPIRE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  ADMIN_ENABLED: booleanValue.default(true),
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD_HASH: z.string().default(""),
  RATE_LIMIT_ENABLED: booleanValue.default(true),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000)
}).superRefine((env, ctx) => {
  if (env.NEWAPI_NOTIFY_URL !== env.ALLOWED_NEWAPI_NOTIFY_URL) {
    ctx.addIssue({ code: "custom", path: ["ALLOWED_NEWAPI_NOTIFY_URL"], message: "必须与 NEWAPI_NOTIFY_URL 完全一致" });
  }
  if (env.NEWAPI_RETURN_URL !== env.ALLOWED_NEWAPI_RETURN_URL) {
    ctx.addIssue({ code: "custom", path: ["ALLOWED_NEWAPI_RETURN_URL"], message: "必须与 NEWAPI_RETURN_URL 完全一致" });
  }
  if (env.ADMIN_ENABLED && !/^\$2[aby]\$/.test(env.ADMIN_PASSWORD_HASH)) {
    ctx.addIssue({ code: "custom", path: ["ADMIN_PASSWORD_HASH"], message: "管理后台启用时必须提供 bcrypt 哈希" });
  }
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = envSchema.parse(environment);
  const certificatePaths = [
    env.ALIPAY_PRIVATE_KEY_PATH,
    env.ALIPAY_APP_CERT_PATH,
    env.ALIPAY_PUBLIC_CERT_PATH,
    env.ALIPAY_ROOT_CERT_PATH
  ];
  for (const path of certificatePaths) accessSync(path, constants.R_OK);

  const minAmountCents = parseMoneyToCents(env.MIN_AMOUNT);
  const maxAmountCents = parseMoneyToCents(env.MAX_AMOUNT);
  if (minAmountCents > maxAmountCents) throw new Error("MIN_AMOUNT 不能大于 MAX_AMOUNT");

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY,
    epayPid: env.EPAY_PID,
    epayKey: env.EPAY_KEY,
    epayType: env.EPAY_TYPE,
    minAmountCents,
    maxAmountCents,
    gatewayPublicUrl: env.GATEWAY_PUBLIC_URL.replace(/\/$/, ""),
    newapiNotifyUrl: env.NEWAPI_NOTIFY_URL,
    newapiReturnUrl: env.NEWAPI_RETURN_URL,
    allowedNotifyUrl: env.ALLOWED_NEWAPI_NOTIFY_URL,
    allowedReturnUrl: env.ALLOWED_NEWAPI_RETURN_URL,
    alipayAppId: env.ALIPAY_APP_ID,
    alipaySellerId: env.ALIPAY_SELLER_ID,
    alipayGateway: env.ALIPAY_GATEWAY,
    alipayKeyType: env.ALIPAY_KEY_TYPE,
    alipayPrivateKeyPath: env.ALIPAY_PRIVATE_KEY_PATH,
    alipayAppCertPath: env.ALIPAY_APP_CERT_PATH,
    alipayPublicCertPath: env.ALIPAY_PUBLIC_CERT_PATH,
    alipayRootCertPath: env.ALIPAY_ROOT_CERT_PATH,
    notifyRetryEnabled: env.NOTIFY_RETRY_ENABLED,
    notifyRetryIntervalSeconds: env.NOTIFY_RETRY_INTERVAL_SECONDS,
    notifyRetryMaxCount: env.NOTIFY_RETRY_MAX_COUNT,
    pendingQueryIntervalSeconds: env.PENDING_QUERY_INTERVAL_SECONDS,
    orderExpireMinutes: env.ORDER_EXPIRE_MINUTES,
    adminEnabled: env.ADMIN_ENABLED,
    adminUsername: env.ADMIN_USERNAME,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    rateLimitEnabled: env.RATE_LIMIT_ENABLED,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS
  };
}
