import { readFileSync } from "node:fs";
import { AlipaySdk } from "alipay-sdk";
import type {
  AlipayNotification,
  AlipayQueryResult,
  AppConfig,
  OrderRecord,
  StringParams
} from "../types.js";
import { formatCents } from "../utils/money.js";

export interface AlipayClient {
  createPaymentHtml(order: OrderRecord): Promise<string>;
  verifyNotification(params: StringParams): boolean;
  parseNotification(params: StringParams): AlipayNotification;
  queryOrder(order: OrderRecord): Promise<AlipayQueryResult>;
  closeOrder(order: OrderRecord): Promise<void>;
}

export class OfficialAlipayClient implements AlipayClient {
  private readonly sdk: AlipaySdk;

  constructor(private readonly config: AppConfig) {
    this.sdk = new AlipaySdk({
      appId: config.alipayAppId,
      privateKey: readFileSync(config.alipayPrivateKeyPath, "utf8"),
      signType: "RSA2",
      keyType: config.alipayKeyType,
      gateway: config.alipayGateway,
      timeout: config.requestTimeoutMs,
      camelcase: false,
      appCertPath: config.alipayAppCertPath,
      alipayPublicCertPath: config.alipayPublicCertPath,
      alipayRootCertPath: config.alipayRootCertPath
    });
  }

  async createPaymentHtml(order: OrderRecord): Promise<string> {
    return await this.sdk.pageExecute("alipay.trade.page.pay", "POST", {
      bizContent: {
        out_trade_no: order.outTradeNo,
        product_code: "FAST_INSTANT_TRADE_PAY",
        total_amount: formatCents(order.amountCents),
        subject: order.subject
      },
      notifyUrl: `${this.config.gatewayPublicUrl}/alipay/notify`,
      returnUrl: `${this.config.gatewayPublicUrl}/alipay/return`
    });
  }

  verifyNotification(params: StringParams): boolean {
    return this.sdk.checkNotifySign(params);
  }

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

  async queryOrder(order: OrderRecord): Promise<AlipayQueryResult> {
    const result = await this.sdk.exec("alipay.trade.query", {
      bizContent: { out_trade_no: order.outTradeNo }
    });
    const data = result as unknown as Record<string, unknown>;
    const code = String(data.code ?? "");
    const subCode = String(data.sub_code ?? "");
    const tradeStatus = data.trade_status ? String(data.trade_status) : null;
    return {
      found: code === "10000" || subCode !== "ACQ.TRADE_NOT_EXIST",
      success: code === "10000" && ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(tradeStatus ?? ""),
      closed: code === "10000" && tradeStatus === "TRADE_CLOSED",
      outTradeNo: String(data.out_trade_no ?? order.outTradeNo),
      tradeNo: data.trade_no ? String(data.trade_no) : null,
      tradeStatus,
      totalAmount: data.total_amount ? String(data.total_amount) : null,
      buyerId: data.buyer_user_id ? String(data.buyer_user_id) : null,
      buyerLogonId: data.buyer_logon_id ? String(data.buyer_logon_id) : null
    };
  }

  async closeOrder(order: OrderRecord): Promise<void> {
    const result = await this.sdk.exec("alipay.trade.close", {
      bizContent: { out_trade_no: order.outTradeNo }
    });
    const data = result as unknown as Record<string, unknown>;
    if (String(data.code ?? "") !== "10000") {
      throw new Error(`支付宝关单失败：${String(data.sub_code ?? data.msg ?? "unknown")}`);
    }
  }
}
