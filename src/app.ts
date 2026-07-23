import bcrypt from "bcryptjs";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { HttpError } from "./errors.js";
import type { OrderRepository } from "./repositories/order-repository.js";
import type { AlipayClient } from "./services/alipay-client.js";
import { safeEqual, verifyEpaySign } from "./services/epay-sign.js";
import type { PaymentService } from "./services/payment-service.js";
import type { AppConfig, NewOrderInput, OrderRecord, StringParams } from "./types.js";
import { formatCents, parseMoneyToCents } from "./utils/money.js";
import { cleanText, escapeHtml, singleString } from "./utils/security.js";

export interface AppDependencies {
  config: AppConfig;
  repository: OrderRepository;
  alipay: AlipayClient;
  paymentService: PaymentService;
  logger: Logger;
}

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

function stringParams(source: unknown): StringParams {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new HttpError(400, "请求参数无效");
  const params: StringParams = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") throw new HttpError(400, `参数 ${key} 必须是单一字符串`);
    params[key] = value;
  }
  return params;
}

function requestParams(request: Request): StringParams {
  return stringParams(request.method === "GET" ? request.query : request.body);
}

function validateSubmit(params: StringParams, config: AppConfig): NewOrderInput {
  const required = ["pid", "type", "out_trade_no", "notify_url", "return_url", "name", "money", "sign_type", "sign"];
  for (const name of required) if (!params[name]) throw new HttpError(400, `缺少参数：${name}`);
  if (params.pid !== config.epayPid) throw new HttpError(403, "商户 ID 无效");
  if (params.type !== config.epayType) throw new HttpError(400, "仅支持支付宝");
  if (params.sign_type?.toUpperCase() !== "MD5") throw new HttpError(400, "sign_type 必须为 MD5");
  if (!verifyEpaySign(params, config.epayKey)) throw new HttpError(403, "EPay 签名无效");

  const outTradeNo = params.out_trade_no ?? "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(outTradeNo)) throw new HttpError(400, "订单号格式无效");
  const subject = cleanText(params.name ?? "");
  if (!subject || subject.length > 256 || /[<>]/.test(subject)) throw new HttpError(400, "商品名称无效");
  const amountCents = parseMoneyToCents(params.money ?? "");
  if (amountCents < config.minAmountCents || amountCents > config.maxAmountCents) {
    throw new HttpError(400, `金额必须在 ${formatCents(config.minAmountCents)} 至 ${formatCents(config.maxAmountCents)} 之间`);
  }
  if (params.notify_url !== config.allowedNotifyUrl) throw new HttpError(400, "notify_url 不在白名单中");
  if (params.return_url !== config.allowedReturnUrl) throw new HttpError(400, "return_url 不在白名单中");
  const clientParam = params.param ? cleanText(params.param).slice(0, 512) : null;
  return {
    outTradeNo,
    epayPid: config.epayPid,
    payType: config.epayType,
    subject,
    amountCents,
    newapiNotifyUrl: params.notify_url,
    newapiReturnUrl: params.return_url,
    clientParam,
    expiredAt: new Date(Date.now() + config.orderExpireMinutes * 60_000)
  };
}

function assertIdempotent(existing: OrderRecord, input: NewOrderInput): void {
  const same = existing.epayPid === input.epayPid &&
    existing.payType === input.payType &&
    existing.subject === input.subject &&
    existing.amountCents === input.amountCents &&
    existing.newapiNotifyUrl === input.newapiNotifyUrl &&
    existing.newapiReturnUrl === input.newapiReturnUrl;
  if (!same) throw new HttpError(409, "重复订单的金额、商品或回调地址不一致");
  if (["CLOSED", "REFUNDED", "FAILED"].includes(existing.status)) throw new HttpError(409, `订单状态 ${existing.status} 不允许再次支付`);
}

function epayStatus(order: OrderRecord): number {
  return ["PAID", "COMPLETED"].includes(order.status) ? 1 : order.status === "CLOSED" ? 2 : 0;
}

export function createApp(dependencies: AppDependencies) {
  const { config, repository, alipay, paymentService, logger } = dependencies;
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(pinoHttp({ logger, redact: ["req.headers.authorization", "req.body.sign", "req.body.key"] }));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use((request, response, next) => {
    request.setTimeout(config.requestTimeoutMs);
    response.setTimeout(config.requestTimeoutMs);
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 64 }));
  app.use(express.json({ limit: "32kb" }));

  const submitLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => !config.rateLimitEnabled,
    message: "请求过于频繁，请稍后重试"
  });

  app.get(["/healthz", "/epay/healthz"], asyncHandler(async (_request, response) => {
    await repository.ping();
    response.status(200).json({ status: "ok", service: "newapi-epay-gateway" });
  }));

  app.all(["/submit.php", "/epay/submit.php"], submitLimiter, asyncHandler(async (request, response) => {
    const input = validateSubmit(requestParams(request), config);
    const result = await repository.createOrGet(input);
    if (!result.created) assertIdempotent(result.order, input);
    const html = await alipay.createPaymentHtml(result.order);
    response.status(200).type("html").send(html);
  }));

  const queryHandler = asyncHandler(async (request, response) => {
    const params = requestParams(request);
    if (params.act !== "order") throw new HttpError(400, "仅支持 act=order");
    if (params.pid !== config.epayPid || !safeEqual(params.key ?? "", config.epayKey)) {
      throw new HttpError(403, "商户凭据无效");
    }
    const order = params.out_trade_no
      ? await repository.findByOutTradeNo(params.out_trade_no)
      : params.trade_no ? await repository.findByTradeNo(params.trade_no) : null;
    if (!order) return void response.status(404).json({ code: -1, msg: "order not found" });
    response.json({
      code: 1,
      msg: "success",
      trade_no: order.alipayTradeNo ?? "",
      out_trade_no: order.outTradeNo,
      type: order.payType,
      status: epayStatus(order),
      money: formatCents(order.amountCents)
    });
  });
  app.all(["/query.php", "/epay/query.php", "/api.php", "/epay/api.php"], queryHandler);

  app.post(["/alipay/notify", "/epay/alipay/notify"], asyncHandler(async (request, response) => {
    const params = stringParams(request.body);
    if (!alipay.verifyNotification(params)) throw new HttpError(400, "支付宝通知验签失败");
    const notification = alipay.parseNotification(params);
    const order = await repository.findByOutTradeNo(notification.outTradeNo);
    if (!order) throw new HttpError(404, "本地订单不存在");
    if (order.status === "COMPLETED" && order.alipayTradeNo === notification.tradeNo) {
      response.type("text/plain").send("success");
      return;
    }
    const paid = await paymentService.acceptPaidOrder(order, notification);
    const notified = await paymentService.notifyNewapi(paid);
    response.status(notified ? 200 : 503).type("text/plain").send(notified ? "success" : "fail");
  }));

  app.get(["/alipay/return", "/epay/alipay/return"], (request, response, next) => {
    try {
      const params = stringParams(request.query);
      if (!alipay.verifyNotification(params)) throw new HttpError(400, "支付宝同步返回验签失败");
      response.redirect(303, config.newapiReturnUrl);
    } catch (error) {
      next(error);
    }
  });

  const adminAuth = asyncHandler(async (request, response, next) => {
    if (!config.adminEnabled) throw new HttpError(404, "管理后台未启用");
    const authorization = request.headers.authorization ?? "";
    if (!authorization.startsWith("Basic ")) {
      response.setHeader("WWW-Authenticate", 'Basic realm="EPay Gateway"');
      response.status(401).send("需要管理员认证");
      return;
    }
    let decoded = "";
    try { decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8"); } catch { /* invalid */ }
    const separator = decoded.indexOf(":");
    const username = separator >= 0 ? decoded.slice(0, separator) : "";
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    const validUser = safeEqual(username, config.adminUsername);
    const validPassword = await bcrypt.compare(password, config.adminPasswordHash);
    if (!validUser || !validPassword) {
      response.setHeader("WWW-Authenticate", 'Basic realm="EPay Gateway"');
      response.status(401).send("管理员凭据无效");
      return;
    }
    next();
  });

  app.get(["/admin", "/epay/admin"], adminAuth, asyncHandler(async (request, response) => {
    const query = cleanText(singleString(request.query.q)).slice(0, 64);
    const orders = await repository.listOrders(100, query || undefined);
    const rows = orders.map((order) => `<tr><td>${escapeHtml(order.outTradeNo)}</td><td>${escapeHtml(order.subject)}</td><td>${formatCents(order.amountCents)}</td><td>${order.status}</td><td>${order.newapiNotifyStatus}</td><td>${order.createdAt.toISOString()}</td><td><form method="post" action="${request.path.startsWith("/epay") ? "/epay" : ""}/admin/orders/${order.outTradeNo}/retry"><button>重试通知</button></form><form method="post" action="${request.path.startsWith("/epay") ? "/epay" : ""}/admin/orders/${order.outTradeNo}/query"><button>支付宝查单</button></form></td></tr>`).join("");
    response.type("html").send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>EPay 订单管理</title><style>body{font-family:sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}th,td{padding:.5rem;border:1px solid #ddd}form{display:inline;margin-right:.4rem}</style><h1>EPay 订单管理</h1><form><input name="q" value="${escapeHtml(query)}" placeholder="NewAPI 订单号"><button>查询</button></form><table><thead><tr><th>订单号</th><th>商品</th><th>金额</th><th>支付状态</th><th>通知状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></html>`);
  }));

  app.post(["/admin/orders/:outTradeNo/retry", "/epay/admin/orders/:outTradeNo/retry"], adminAuth, asyncHandler(async (request, response) => {
    const order = await repository.findByOutTradeNo(singleString(request.params.outTradeNo));
    if (!order) throw new HttpError(404, "订单不存在");
    if (!order.alipayTradeNo) throw new HttpError(409, "订单尚未支付");
    await paymentService.notifyNewapi(order);
    response.redirect(303, request.path.startsWith("/epay") ? "/epay/admin" : "/admin");
  }));

  app.post(["/admin/orders/:outTradeNo/query", "/epay/admin/orders/:outTradeNo/query"], adminAuth, asyncHandler(async (request, response) => {
    const order = await repository.findByOutTradeNo(singleString(request.params.outTradeNo));
    if (!order) throw new HttpError(404, "订单不存在");
    await paymentService.queryAndReconcile(order);
    response.redirect(303, request.path.startsWith("/epay") ? "/epay/admin" : "/admin");
  }));

  app.use((_request, response) => response.status(404).json({ error: "not_found" }));
  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "服务器内部错误";
    request.log?.[status >= 500 ? "error" : "warn"]({ err: error }, message);
    response.status(status).json({ error: status >= 500 ? "服务器内部错误" : message });
  });
  return app;
}
