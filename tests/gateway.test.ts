import request from "supertest";
import { describe, expect, it } from "vitest";
import { createEpaySign } from "../src/services/epay-sign.js";
import { FakeNotifier, testApplication } from "./helpers.js";

function submitParams(key: string, overrides: Record<string, string> = {}) {
  const params: Record<string, string> = {
    pid: "10001",
    type: "alipay",
    out_trade_no: "NA202607230001",
    notify_url: "https://ltj666.ltd/api/user/epay/notify",
    return_url: "https://ltj666.ltd/console/log",
    name: "充值 1 元",
    money: "1.00",
    sign_type: "MD5",
    ...overrides
  };
  params.sign = createEpaySign(params, key);
  return params;
}

function notifyParams(overrides: Record<string, string> = {}) {
  return {
    app_id: "2021006175665149",
    seller_id: "2088000000000000",
    out_trade_no: "NA202607230001",
    trade_no: "20260723220000000001",
    trade_status: "TRADE_SUCCESS",
    total_amount: "1.00",
    buyer_id: "2088123456789000",
    buyer_logon_id: "demo@example.com",
    sign: "fake-rsa2",
    sign_type: "RSA2",
    ...overrides
  };
}

describe("网关路由与支付流程", () => {
  it.each(["/submit.php", "/epay/submit.php"])("兼容下单路由 %s", async (path) => {
    const context = testApplication();
    const response = await request(context.app).post(path).type("form").send(submitParams(context.config.epayKey));
    expect(response.status).toBe(200);
    expect(response.type).toMatch(/html/);
    expect(response.text).toContain("NA202607230001");
  });

  it("拒绝签名正确但不在白名单的回调 URL", async () => {
    const context = testApplication();
    const response = await request(context.app).post("/epay/submit.php").type("form").send(submitParams(context.config.epayKey, {
      notify_url: "http://127.0.0.1/internal"
    }));
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("白名单");
  });

  it("重复订单参数一致可重放，不一致则拒绝", async () => {
    const context = testApplication();
    const first = submitParams(context.config.epayKey);
    expect((await request(context.app).post("/submit.php").type("form").send(first)).status).toBe(200);
    expect((await request(context.app).post("/epay/submit.php").type("form").send(first)).status).toBe(200);
    const changed = submitParams(context.config.epayKey, { money: "2.00" });
    expect((await request(context.app).post("/submit.php").type("form").send(changed)).status).toBe(409);
  });

  it.each(["/alipay/notify", "/epay/alipay/notify"])("处理并幂等响应支付宝通知 %s", async (path) => {
    const context = testApplication();
    await request(context.app).post("/submit.php").type("form").send(submitParams(context.config.epayKey));
    const first = await request(context.app).post(path).type("form").send(notifyParams());
    const duplicate = await request(context.app).post(path).type("form").send(notifyParams());
    expect(first.status).toBe(200);
    expect(first.text).toBe("success");
    expect(duplicate.text).toBe("success");
    expect(context.notifier.calls).toBe(1);
    expect(context.repository.orders.get("NA202607230001")?.status).toBe("COMPLETED");
  });

  it("金额不一致时拒绝支付宝通知", async () => {
    const context = testApplication();
    await request(context.app).post("/submit.php").type("form").send(submitParams(context.config.epayKey));
    const response = await request(context.app).post("/alipay/notify").type("form").send(notifyParams({ total_amount: "2.00" }));
    expect(response.status).toBe(500);
    expect(context.notifier.calls).toBe(0);
  });

  it("NewAPI 故障后保留支付状态并可重试成功", async () => {
    const notifier = new FakeNotifier([
      { httpStatus: 500, responseSummary: "error", errorType: "INVALID_RESPONSE", durationMs: 5, succeeded: false, errorMessage: "NewAPI 返回 500" },
      { httpStatus: 200, responseSummary: "success", errorType: null, durationMs: 2, succeeded: true, errorMessage: null }
    ]);
    const context = testApplication({ notifier });
    await request(context.app).post("/submit.php").type("form").send(submitParams(context.config.epayKey));
    const failed = await request(context.app).post("/alipay/notify").type("form").send(notifyParams());
    expect(failed.status).toBe(503);
    const order = context.repository.orders.get("NA202607230001");
    expect(order?.status).toBe("PAID");
    expect(order?.newapiNotifyStatus).toBe("FAILED");
    expect(await context.paymentService.notifyNewapi(order!)).toBe(true);
    expect(order?.status).toBe("COMPLETED");
    expect(notifier.calls).toBe(2);
  });

  it("重复支付宝通知不会冲掉正在执行的 NewAPI 通知锁", async () => {
    const context = testApplication();
    await request(context.app).post("/submit.php").type("form").send(submitParams(context.config.epayKey));
    const order = context.repository.orders.get("NA202607230001")!;
    const notification = context.alipay.parseNotification(notifyParams());
    const paid = await context.paymentService.acceptPaidOrder(order, notification);
    expect(await context.repository.claimNotification(paid.id, 20)).not.toBeNull();
    const duplicate = await context.paymentService.acceptPaidOrder(paid, notification);
    expect(duplicate.newapiNotifyStatus).toBe("PROCESSING");
    expect(await context.repository.claimNotification(paid.id, 20)).toBeNull();
  });

  it("提供 EPay 查询接口", async () => {
    const context = testApplication();
    await request(context.app).post("/submit.php").type("form").send(submitParams(context.config.epayKey));
    const response = await request(context.app).get("/epay/api.php").query({
      act: "order", pid: context.config.epayPid, key: context.config.epayKey, out_trade_no: "NA202607230001"
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ code: 1, status: 0, money: "1.00" });
  });
});
