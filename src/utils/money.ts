const MONEY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export function parseMoneyToCents(value: string): number {
  const match = MONEY_PATTERN.exec(value);
  if (!match) {
    throw new Error("金额必须是最多两位小数的正十进制数");
  }
  const yuan = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = yuan * 100 + Number(fraction || "0");
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("金额超出有效范围");
  }
  return cents;
}

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("无效的分值金额");
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
