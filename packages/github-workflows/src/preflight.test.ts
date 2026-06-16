import { describe, expect, it } from "vitest";
import { runPreflightChecks } from "./preflight.js";

function createEnv(values: Record<string, string | undefined>) {
  return { get: (key: string) => values[key] };
}

describe("runPreflightChecks", () => {
  it("passes when POE_API_KEY is set and node version is 18+", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({ POE_API_KEY: "key-123" }), nodeVersion: "v22.0.0" })
    ).not.toThrow();
  });

  it("throws when POE_API_KEY is missing", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({}), nodeVersion: "v22.0.0" })
    ).toThrow("Missing required environment variable: POE_API_KEY");
  });

  it("throws when POE_API_KEY is empty", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({ POE_API_KEY: "" }), nodeVersion: "v22.0.0" })
    ).toThrow("Missing required environment variable: POE_API_KEY");
  });

  it("throws when POE_API_KEY contains only whitespace", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({ POE_API_KEY: "   " }), nodeVersion: "v22.0.0" })
    ).toThrow("Missing required environment variable: POE_API_KEY");
  });

  it("throws when node version is below 18", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({ POE_API_KEY: "key" }), nodeVersion: "v16.20.2" })
    ).toThrow("Node.js 18 or later is required (current: v16.20.2).");
  });

  it("throws when node version is unparseable", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({ POE_API_KEY: "key" }), nodeVersion: "not-a-version" })
    ).toThrow("Node.js 18 or later is required (current: not-a-version).");
  });

  it("accepts node version 18 exactly", () => {
    expect(() =>
      runPreflightChecks({ env: createEnv({ POE_API_KEY: "key" }), nodeVersion: "v18.0.0" })
    ).not.toThrow();
  });
});
