import { describe, it, expect } from "vitest";
import { resolveIsolatedEnvDetails, resolveProviderRuntimeEnv, resolveCliSettings } from "./isolated-env.js";
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
  agentBaseUrl: "https://agent.example.com",
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

    it("names the configure recovery path when no active provider is present", async () => {
      const failure = resolveIsolatedEnvDetails(
        makeEnv(),
        { ...baseIsolated, env: { MY_KEY: { kind: "providerCredential" as const } } },
        "test-service"
      );
      await expect(failure).rejects.toThrow(/poe-code configure/);
      await expect(failure).rejects.toThrow(/--provider/);
      await expect(failure).rejects.toThrow(/--base-url/);
    });

    it("supports a declarative prefix", async () => {
      const details = await resolveIsolatedEnvDetails(
        makeEnv(),
        {
          ...baseIsolated,
          env: {
            AUTH_HEADER: {
              kind: "providerCredential" as const,
              prefix: "Authorization: Bearer "
            }
          }
        },
        "test-service",
        testProvider
      );
      expect(details.env.AUTH_HEADER).toBe("Authorization: Bearer test-credential-secret");
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

  describe("agentBaseUrl kind", () => {
    it("resolves to activeProvider.agentBaseUrl", async () => {
      const details = await resolveIsolatedEnvDetails(
        makeEnv(),
        { ...baseIsolated, env: { BASE_URL: { kind: "agentBaseUrl" as const } } },
        "test-service",
        testProvider
      );
      expect(details.env.BASE_URL).toBe("https://agent.example.com");
    });
  });
});

describe("resolveProviderRuntimeEnv", () => {
  it("preserves explicitly configured special environment names", async () => {
    const variables = JSON.parse('{"__proto__":"visible"}') as Record<string, string>;
    const result = await resolveProviderRuntimeEnv(makeEnv(), variables, "test-service");

    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result["__proto__"]).toBe("visible");
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

  describe("agentBaseUrl kind in env", () => {
    it("resolves to activeProvider.agentBaseUrl", async () => {
      const result = await resolveCliSettings(
        {
          values: {},
          env: { BASE_URL: { kind: "agentBaseUrl" as const } }
        },
        makeEnv(),
        testProvider
      );
      expect(result.env).toEqual({ BASE_URL: "https://agent.example.com" });
    });
  });
});
