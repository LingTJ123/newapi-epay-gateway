import type { AppConfig, NotifyAttemptInput, OrderRecord } from "../types.js";
import { formatCents } from "../utils/money.js";
import { summarize } from "../utils/security.js";
import { createEpaySign } from "./epay-sign.js";

export interface NewapiNotifyResult extends NotifyAttemptInput {
  errorMessage: string | null;
}

export interface NewapiNotifier {
  notify(order: OrderRecord): Promise<NewapiNotifyResult>;
}

export class HttpNewapiNotifier implements NewapiNotifier {
  constructor(private readonly config: AppConfig) {}

  async notify(order: OrderRecord): Promise<NewapiNotifyResult> {
    const start = Date.now();
    const params: Record<string, string> = {
      pid: this.config.epayPid,
      trade_no: order.alipayTradeNo ?? "",
      out_trade_no: order.outTradeNo,
      type: "alipay",
      name: order.subject,
      money: formatCents(order.amountCents),
      trade_status: "TRADE_SUCCESS",
      sign_type: "MD5"
    };
    params.sign = createEpaySign(params, this.config.epayKey);

    try {
      const response = await fetch(this.config.newapiNotifyUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          "user-agent": "newapi-epay-gateway/1.0"
        },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        redirect: "error"
      });
      const body = await response.text();
      const succeeded = response.ok && body.trim() === "success";
      const errorMessage = succeeded ? null : `NewAPI 返回 ${response.status}: ${summarize(body)}`;
      return {
        httpStatus: response.status,
        responseSummary: summarize(body),
        errorType: succeeded ? null : "INVALID_RESPONSE",
        durationMs: Date.now() - start,
        succeeded,
        errorMessage
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知网络错误";
      return {
        httpStatus: null,
        responseSummary: null,
        errorType: error instanceof DOMException && error.name === "TimeoutError" ? "TIMEOUT" : "NETWORK_ERROR",
        durationMs: Date.now() - start,
        succeeded: false,
        errorMessage: summarize(message)
      };
    }
  }
}
