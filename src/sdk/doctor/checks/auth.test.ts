import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHomeFs } from "../../../../tests/test-helpers.js";
import type { FileSystem } from "../../../utils/file-system.js";
import type { DoctorContext } from "../types.js";
import type { HttpClient, HttpResponse } from "../../../cli/http.js";
import { authChecks } from "./auth.js";

const homeDir = "/home/test";
const configPath = homeDir + "/.poe-code/config.json";

function createContext(
  fs: FileSystem,
  overrides: {
    readApiKey?: () => Promise<string | null>;
    httpClient?: HttpClient;
    dryRun?: boolean;
  } = {}
): DoctorContext {
  return {
    fs,
    env: {
      cwd: "/repo",
      homeDir,
      platform: "darwin",
      configPath,
      logDir: homeDir + "/.poe-code/logs",
      poeApiBaseUrl: "https://api.poe.com/v1",
      poeBaseUrl: "https://api.poe.com",
      variables: {},
      resolveHomePath: (...segments: string[]) =>
        [homeDir, ...segments].join("/"),
      getVariable: () => undefined
    },
    runCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
    httpClient: overrides.httpClient ?? vi.fn(),
    readApiKey: overrides.readApiKey ?? vi.fn(async () => null),
    verbose: false,
    dryRun: overrides.dryRun ?? false,
    previousResults: new Map()
  };
}

function okResponse(): HttpResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({ current_point_balance: 1000 })
  };
}

function unauthorizedResponse(): HttpResponse {
  return {
    ok: false,
    status: 401,
    json: async () => ({})
  };
}

describe("auth checks", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  describe("auth.api-key-present", () => {
    it("passes when API key is available", async () => {
      const ctx = createContext(fs, {
        readApiKey: async () => "sk-test-key"
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-present")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when no API key is available", async () => {
      const ctx = createContext(fs, {
        readApiKey: async () => null
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-present")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toContain("poe-code login");
    });
  });

  describe("auth.api-key-valid", () => {
    it("passes when API returns 200", async () => {
      const httpClient = vi.fn(async () => okResponse());
      const ctx = createContext(fs, {
        readApiKey: async () => "sk-valid",
        httpClient
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
      expect(httpClient).toHaveBeenCalledWith(
        "https://api.poe.com/usage/current_balance",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer sk-valid"
          })
        })
      );
    });

    it("fails when API returns 401", async () => {
      const ctx = createContext(fs, {
        readApiKey: async () => "sk-invalid",
        httpClient: vi.fn(async () => unauthorizedResponse())
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toContain("poe-code login");
    });

    it("skips when api-key-present failed", async () => {
      const ctx = createContext(fs, {
        readApiKey: async () => null
      });
      ctx.previousResults.set("auth.api-key-present", {
        status: "fail",
        message: "No API key"
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });

    it("skips during dry run", async () => {
      const ctx = createContext(fs, {
        readApiKey: async () => "sk-test",
        dryRun: true
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });

    it("fails when network error occurs", async () => {
      const ctx = createContext(fs, {
        readApiKey: async () => "sk-test",
        httpClient: vi.fn(async () => {
          throw new Error("fetch failed");
        })
      });
      const checks = authChecks();
      const check = checks.find((c) => c.id === "auth.api-key-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.message).toContain("fetch failed");
    });
  });
});
