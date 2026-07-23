import { describe, expect, it } from "vitest";
import { formatCents, parseMoneyToCents } from "../src/utils/money.js";

describe("金额处理", () => {
  it.each([["0.01", 1], ["1", 100], ["1.0", 100], ["100.99", 10099]])("%s 转为 %i 分", (value, cents) => {
    expect(parseMoneyToCents(value)).toBe(cents);
  });
  it.each(["0", "-1", "1.001", "1e2", "NaN", "Infinity", ".5", "01.00"])("拒绝非法金额 %s", (value) => {
    expect(() => parseMoneyToCents(value)).toThrow();
  });
  it("格式化金额", () => expect(formatCents(101)).toBe("1.01"));
});
