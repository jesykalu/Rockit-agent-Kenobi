import { it, expect } from "vitest";
import { validateChangedSyntax } from "../lib/validate-output";
it("blocks a replacement that breaks code or JSON without executing uploaded code", () => {
  expect(() =>
    validateChangedSyntax(
      "app.ts",
      "const client = 'Acme';",
      "const client = 'customer's bank';",
    ),
  ).toThrow("invalid code");
  expect(() =>
    validateChangedSyntax(
      "package.json",
      '{"name":"acme"}',
      '{"name":"a "bank""}',
    ),
  ).toThrow("invalid JSON");
  expect(() =>
    validateChangedSyntax(
      "app.ts",
      "const client = 'Acme';",
      "const client = 'A retail bank';",
    ),
  ).not.toThrow();
});
