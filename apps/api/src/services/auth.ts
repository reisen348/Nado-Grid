import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionToken(secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt: Date.now()
    }),
    "utf8"
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload, secret);
  if (!safeEqual(signature, expected)) return false;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { issuedAt?: number };
    return typeof decoded.issuedAt === "number" && Date.now() - decoded.issuedAt < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

export function verifyPassword(input: string | undefined, expected: string): boolean {
  if (!input) return false;
  return safeEqual(input, expected);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
