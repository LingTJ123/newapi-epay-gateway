import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEpaySign, verifyEpaySign } from "../src/services/epay-sign.js";

describe("EPay MD5 签名", () => {
  it("按 ASCII 排序、忽略空值和签名字段", () => {
    const params = { z: "last", a: "first", empty: "", sign: "old", sign_type: "MD5" };
    const expected = createHash("md5").update("a=first&z=lastsecret").digest("hex");
    expect(createEpaySign(params, "secret")).toBe(expected);
  });

  it("可验签且拒绝错误签名", () => {
    const params: Record<string, string> = { pid: "10001", money: "1.00", sign_type: "MD5" };
    params.sign = createEpaySign(params, "secret");
    expect(verifyEpaySign(params, "secret")).toBe(true);
    expect(verifyEpaySign({ ...params, sign: "0".repeat(32) }, "secret")).toBe(false);
  });
});
