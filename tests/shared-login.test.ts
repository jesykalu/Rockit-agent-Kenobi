import { afterEach, expect, it, vi } from "vitest";
import { authenticate } from "../lib/auth";
afterEach(() => vi.unstubAllEnvs());
const request = (name: string, password: string) =>
  new Request("https://kenobi.example", {
    headers: {
      authorization:
        "Basic " + Buffer.from(`${name}:${password}`).toString("base64"),
    },
  });
it("accepts a separate helper account without replacing personal accounts", () => {
  vi.stubEnv(
    "KENOBI_USERS",
    JSON.stringify({ owner: "personal-password-for-test-only" }),
  );
  vi.stubEnv(
    "KENOBI_HELPER_USERS",
    JSON.stringify({
      "kenobi-team": "shared-password-for-test-only",
      owner: "overriding-password-not-allowed",
    }),
  );
  expect(
    authenticate(request("kenobi-team", "shared-password-for-test-only")),
  ).toBe("kenobi-team");
  expect(
    authenticate(request("owner", "personal-password-for-test-only")),
  ).toBe("owner");
  expect(
    authenticate(request("owner", "overriding-password-not-allowed")),
  ).toBeNull();
  expect(authenticate(request("kenobi-team", "wrong"))).toBeNull();
});
