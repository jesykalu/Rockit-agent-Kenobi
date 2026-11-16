import { it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("../lib/auth", () => ({ authenticate: () => "test" }));
import { proxy } from "../proxy";
it("permits the Blob SDK upload API while retaining the private storage policy", () => {
  process.env.KENOBI_USERS = "{}";
  process.env.KENOBI_ORIGIN = "https://kenobi.example";
  const response = proxy(new NextRequest("https://kenobi.example/"));
  const connect = response.headers.get("Content-Security-Policy")!.split(";").find(d => d.trim().startsWith("connect-src"))!;
  expect(connect.split(/\s+/)).toContain("https://vercel.com/api/blob/");
  expect(connect.split(/\s+/)).not.toContain("*");
});
