import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHomeFs } from "../../../../tests/test-helpers.js";
import type { FileSystem } from "../../../utils/file-system.js";
import type { DoctorContext } from "../types.js";
import { systemChecks } from "./system.js";

const homeDir = "/home/test";
const configPath = homeDir + "/.poe-code/config.json";
const poeCodeDir = homeDir + "/.poe-code";

function createContext(fs: FileSystem): DoctorContext {
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
    httpClient: vi.fn(),
    readApiKey: vi.fn(async () => null),
    verbose: false,
    dryRun: false,
    previousResults: new Map()
  };
}

describe("system checks", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  describe("system.home-dir", () => {
    it("passes when .poe-code directory exists", async () => {
      await fs.mkdir(poeCodeDir, { recursive: true });
      const ctx = createContext(fs);
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.home-dir")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when .poe-code directory does not exist", async () => {
      // createHomeFs only creates homeDir, not .poe-code
      // Remove the homeDir so .poe-code definitely doesn't exist
      const freshFs = createHomeFs("/other");
      const ctx = createContext(freshFs);
      ctx.env = {
        ...ctx.env,
        homeDir: "/other",
        configPath: "/other/.poe-code/config.json",
        resolveHomePath: (...segments: string[]) =>
          ["/other", ...segments].join("/")
      };
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.home-dir")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toContain("poe-code configure");
    });
  });

  describe("system.config-valid", () => {
    it("passes when config.json is valid JSON", async () => {
      await fs.mkdir(poeCodeDir, { recursive: true });
      await fs.writeFile(configPath, '{"apiKey":"sk-test"}');
      const ctx = createContext(fs);
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.config-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("fails when config.json has invalid JSON", async () => {
      await fs.mkdir(poeCodeDir, { recursive: true });
      await fs.writeFile(configPath, "{broken");
      const ctx = createContext(fs);
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.config-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("fail");
      expect(result.fix).toBeDefined();
    });

    it("skips when config.json does not exist", async () => {
      await fs.mkdir(poeCodeDir, { recursive: true });
      const ctx = createContext(fs);
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.config-valid")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });
  });

  describe("system.config-backups", () => {
    it("passes when no backup files exist", async () => {
      await fs.mkdir(poeCodeDir, { recursive: true });
      const ctx = createContext(fs);
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.config-backups")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("pass");
    });

    it("warns when invalid backup files exist", async () => {
      await fs.mkdir(poeCodeDir, { recursive: true });
      await fs.writeFile(
        poeCodeDir + "/config.json.invalid-2024-01-01.json",
        "{}"
      );
      const ctx = createContext(fs);
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.config-backups")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("warn");
      expect(result.message).toContain("1");
    });

    it("skips when .poe-code directory does not exist", async () => {
      const freshFs = createHomeFs("/other");
      const ctx = createContext(freshFs);
      ctx.env = {
        ...ctx.env,
        homeDir: "/other",
        configPath: "/other/.poe-code/config.json",
        resolveHomePath: (...segments: string[]) =>
          ["/other", ...segments].join("/")
      };
      const checks = systemChecks();
      const check = checks.find((c) => c.id === "system.config-backups")!;
      const result = await check.run(ctx);
      expect(result.status).toBe("skip");
    });
  });
});
