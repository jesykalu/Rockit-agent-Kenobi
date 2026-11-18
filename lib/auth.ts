import { createHash, timingSafeEqual } from "node:crypto";
export function authenticate(request: Request): string | null {
  const configured = process.env.KENOBI_USERS;
  if (!configured) return null;
  const users = {
    ...JSON.parse(process.env.KENOBI_HELPER_USERS || "{}"),
    ...JSON.parse(configured),
  } as Record<string, string>;
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Basic ")) return null;
  const credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
  const split = credentials.indexOf(":");
  if (split < 1) return null;
  const user = credentials.slice(0, split),
    password = credentials.slice(split + 1),
    expected = Object.hasOwn(users, user) ? users[user] : "";
  if (typeof expected !== "string" || expected.length < 24) return null;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(password), hash(expected)) ? user : null;
}
export function requireUser(request: Request) {
  const user = authenticate(request);
  if (!user) throw new Error("Sign in to continue.");
  return user;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.KENOBI_ORIGIN;
  if (!expected || origin !== expected)
    throw new Error("Request origin is not permitted. Check KENOBI_ORIGIN.");
}
