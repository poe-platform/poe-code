import { describe, it, expect } from "vitest";
import { resolveIsolatedEnvDetails, resolveCliSettings } from "./isolated-env.js";
import { createCliEnvironment } from "./environment.js";
import type { ActiveProvider } from "./commands/shared.js";

const homeDir = "/home/test";
const cwd = "/repo";

function makeEnv(variables: Record<string, string> = {}) {
  return createCliEnvironment({ cwd, homeDir, variables });
}

const baseIsolated = {
  agentBinary: "test-agent",
  requiresConfig: false as const,
  env: {} as Record<string, never>
};

const testProvider: ActiveProvider = {
  id: "test-provider",
  apiShape: "openai-responses",
  baseUrl: "https://test.example.com",
  credential: "test-credential-secret",
  extraEnv: {}
};

describe("resolveIsolatedEnvDetails", () => {
  describe("providerCredential kind", () => {
    it("resolves to activeProvider.credential", async () => {
      const details = await resolveIsolatedEnvDetails(
        makeEnv(),
        { ...baseIsolated, env: { MY_KEY: { kind: "providerCredential" as const } } },
        "test-service",
        testProvider
      );
      expect(details.env.MY_KEY).toBe("test-credential-secret");
    });
  });

  describe("providerBaseUrl kind", () => {
    it("resolves to activeProvider.baseUrl", async () => {
      const details = await resolveIsolatedEnvDetails(
        makeEnv(),
        { ...baseIsolated, env: { BASE_URL: { kind: "providerBaseUrl" as const } } },
        "test-service",
        testProvider
      );
      expect(details.env.BASE_URL).toBe("https://test.example.com");
    });
  });
});

describe("resolveCliSettings", () => {
  describe("providerCredential kind in resolved", () => {
    it("resolves to activeProvider.credential", async () => {
      const result = await resolveCliSettings(
        {
          values: { someFlag: true },
          resolved: { apiKey: { kind: "providerCredential" as const } }
        },
        makeEnv(),
        testProvider
      );
      expect(result.apiKey).toBe("test-credential-secret");
    });
  });

  describe("providerBaseUrl kind in resolved", () => {
    it("resolves to activeProvider.baseUrl", async () => {
      const result = await resolveCliSettings(
        {
          values: {},
          resolved: { baseUrl: { kind: "providerBaseUrl" as const } }
        },
        makeEnv(),
        testProvider
      );
      expect(result.baseUrl).toBe("https://test.example.com");
    });
  });
});
