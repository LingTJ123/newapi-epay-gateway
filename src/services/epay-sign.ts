import { createHash, timingSafeEqual } from "node:crypto";

export function createEpaySign(params: Record<string, unknown>, key: string): string {
  const content = Object.entries(params)
    .filter(([name, value]) =>
      name !== "sign" &&
      name !== "sign_type" &&
      value !== undefined &&
      value !== null &&
      String(value) !== ""
    )
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join("&");
  return createHash("md5").update(content + key, "utf8").digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyEpaySign(params: Record<string, unknown>, key: string): boolean {
  const supplied = typeof params.sign === "string" ? params.sign.toLowerCase() : "";
  return safeEqual(createEpaySign(params, key), supplied);
}
