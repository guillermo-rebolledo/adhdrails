import { describe, expect, it } from "vitest";

import { parseEnvFile } from "./env-file";

describe("parseEnvFile", () => {
  it('parses the quoted KEY="value" shape the Vercel CLI writes', () => {
    const parsed = parseEnvFile(
      [
        'APP_ENV="staging"',
        'DATABASE_URL="postgresql://user:pw@host/db?sslmode=require"',
      ].join("\n"),
    );

    expect(parsed).toEqual({
      APP_ENV: "staging",
      DATABASE_URL: "postgresql://user:pw@host/db?sslmode=require",
    });
  });

  it("ignores comments and blank lines", () => {
    const parsed = parseEnvFile(
      ["# a comment", "", "  ", "APP_ENV=production", "# trailing"].join("\n"),
    );

    expect(parsed).toEqual({ APP_ENV: "production" });
  });

  it("unescapes newlines inside double-quoted values", () => {
    const parsed = parseEnvFile('KEY="line-one\\nline-two"');

    expect(parsed.KEY).toBe("line-one\nline-two");
  });

  it("keeps unquoted values and an equals sign inside the value", () => {
    const parsed = parseEnvFile("TOKEN=abc=def");

    expect(parsed.TOKEN).toBe("abc=def");
  });
});
