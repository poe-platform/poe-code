import { describe, it, expect, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import type { FileSystem } from "../utils/file-system.js";
import {
  loadConfiguredServices,
  saveConfiguredService,
  unconfigureService,
  deleteConfig,
  saveConfig,
  loadConfig
} from "./config.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("config.ts — saveConfig / loadConfig", () => {
  const configPath = resolveConfigPath("/home/user");
  let fs: FileSystem;

  beforeEach(async () => {
    fs = createMemFs();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  });

  it("saves and loads an API key", async () => {
    await saveConfig({ fs, filePath: configPath, apiKey: "sk-test" });
    await expect(loadConfig({ fs, filePath: configPath })).resolves.toBe("sk-test");
  });

  it("returns null when no key is stored", async () => {
    await expect(loadConfig({ fs, filePath: configPath })).resolves.toBeNull();
  });

  it("deleteConfig removes the config file", async () => {
    await saveConfig({ fs, filePath: configPath, apiKey: "sk-test" });
    await deleteConfig({ fs, filePath: configPath });
    await expect(loadConfig({ fs, filePath: configPath })).resolves.toBeNull();
  });
});

describe("config.ts — loadConfiguredServices / saveConfiguredService", () => {
  const configPath = resolveConfigPath("/home/user");
  let fs: FileSystem;

  beforeEach(async () => {
    fs = createMemFs();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  });

  it("saves and loads configured service metadata", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: { files: ["/home/user/.codex/config.toml"], provider: "poe" }
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["codex"]).toEqual({
      files: ["/home/user/.codex/config.toml"],
      provider: "poe"
    });
  });

  it("saves with non-poe provider and preserves it on reload", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: { files: ["/home/user/.claude/settings.json"], provider: "anthropic" }
    });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["claude-code"]!.provider).toBe("anthropic");
  });

  it("unconfigureService removes the service entry", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: { files: [], provider: "poe" }
    });

    await unconfigureService({ fs, filePath: configPath, service: "codex" });
    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["codex"]).toBeUndefined();
  });

  it("migrateServicesProvider tags missing provider entries with poe", async () => {
    const raw = {
      configured_services: {
        codex: { files: ["/home/user/.codex/config.toml"] }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(raw, null, 2), { encoding: "utf8" });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["codex"]!.provider).toBe("poe");
  });

  it("migrateServicesProvider does not overwrite existing provider", async () => {
    const raw = {
      configured_services: {
        codex: { files: [], provider: "anthropic" }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(raw, null, 2), { encoding: "utf8" });

    const services = await loadConfiguredServices({ fs, filePath: configPath });
    expect(services["codex"]!.provider).toBe("anthropic");
  });
});
