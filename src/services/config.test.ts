import { describe, it, expect, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
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

  it("does not write global config through a symlinked state directory", async () => {
    const outsidePath = "/outside/config.json";
    fs = createMemFs();
    await fs.mkdir("/home/user", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.symlink("/outside", path.dirname(configPath));

    await expect(saveConfig({ fs, filePath: configPath, apiKey: "sk-test" })).rejects.toThrow(
      "symbolic link"
    );
    await expect(fs.stat(outsidePath)).rejects.toBeTruthy();
  });

  it("does not delete global config through a symlinked state directory", async () => {
    const outsidePath = "/outside/config.json";
    fs = createMemFs();
    await fs.mkdir("/home/user", { recursive: true });
    await fs.mkdir("/outside", { recursive: true });
    await fs.writeFile(outsidePath, "outside", { encoding: "utf8" });
    await fs.symlink("/outside", path.dirname(configPath));

    await expect(deleteConfig({ fs, filePath: configPath })).rejects.toThrow("symbolic link");
    await expect(fs.readFile(outsidePath, "utf8")).resolves.toBe("outside");
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
      provider: "poe",
      apiShape: "openai-responses",
      files: ["/home/user/.codex/config.toml"]
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
    expect(services["claude-code"]!.apiShape).toBe("anthropic-messages");
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
    const warn = vi.fn();

    const services = await loadConfiguredServices({ fs, filePath: configPath, warn });
    expect(services["codex"]!.provider).toBe("anthropic");
    expect(warn).toHaveBeenCalledWith(
      'Unable to derive apiShape for configured service "codex" with provider "anthropic".'
    );
  });
});
