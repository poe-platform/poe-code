import { describe, it, expect, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import type { FileSystem } from "../utils/file-system.js";
import {
  loadConfig,
  saveConfig,
  loadConfiguredServices,
  saveConfiguredService,
  unconfigureService,
  saveDefaultModel,
  loadDefaultModels,
  resolveDefaultModel
} from "./config.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("config store", () => {
  const configPath = "/home/user/.poe-code/config.json";
  let fs: FileSystem;

  beforeEach(async () => {
    fs = createMemFs();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  });

  it("returns stored api key when file is valid json", async () => {
    await saveConfig({
      fs,
      filePath: configPath,
      apiKey: "test-key"
    });

    const apiKey = await loadConfig({
      fs,
      filePath: configPath
    });

    expect(apiKey).toBe("test-key");
  });

  it("preserves configured services when updating the api key", async () => {
    const initial = {
      apiKey: "initial",
      configured_services: {
        codex: {
          files: ["/home/user/.codex/config.toml"]
        }
      }
    };
    await fs.writeFile(configPath, JSON.stringify(initial, null, 2), {
      encoding: "utf8"
    });

    await saveConfig({
      fs,
      filePath: configPath,
      apiKey: "updated"
    });

    const updated = JSON.parse(
      await fs.readFile(configPath, "utf8")
    );
    expect(updated.apiKey).toBe("updated");
    expect(updated.configured_services).toEqual(initial.configured_services);
  });

  it("stores configured service metadata and returns it on load", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "opencode",
      metadata: {
        files: [
          "/home/user/.config/opencode/config.json",
          "/home/user/.local/share/opencode/auth.json"
        ]
      }
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: configPath
    });

    expect(services).toEqual({
      opencode: {
        files: [
          "/home/user/.config/opencode/config.json",
          "/home/user/.local/share/opencode/auth.json"
        ]
      }
    });
  });

  it("removes configured service metadata", async () => {
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: {
        files: ["/home/user/.claude/settings.json"]
      }
    });

    await unconfigureService({
      fs,
      filePath: configPath,
      service: "claude-code"
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: configPath
    });
    expect(services).toEqual({});
  });

  it("migrates legacy credentials.json to config.json on first read", async () => {
    const legacyPath = path.join(path.dirname(configPath), "credentials.json");
    const data = {
      configured_services: {
        codex: { files: ["/home/user/.codex/config.toml"] }
      }
    };
    await fs.writeFile(legacyPath, JSON.stringify(data, null, 2), {
      encoding: "utf8"
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: configPath
    });

    expect(services).toEqual(data.configured_services);

    await expect(fs.readFile(configPath, "utf8")).resolves.toBeDefined();
    await expect(fs.readFile(legacyPath, "utf8")).rejects.toThrow();
  });

  it("backs up and resets invalid json content", async () => {
    await fs.writeFile(configPath, "test\n", { encoding: "utf8" });

    const apiKey = await loadConfig({
      fs,
      filePath: configPath
    });

    expect(apiKey).toBeNull();

    const configDir = path.dirname(configPath);
    const entries = await fs.readdir(configDir);
    const backupName = entries.find((entry) =>
      entry.startsWith("config.json.invalid-")
    );
    expect(backupName).toBeDefined();

    const backupPath = path.join(configDir, backupName as string);
    const backupContent = await fs.readFile(backupPath, "utf8");
    expect(backupContent).toBe("test\n");

    const rewritten = await fs.readFile(configPath, "utf8");
    expect(JSON.parse(rewritten)).toEqual({});
  });
});

describe("default model store", () => {
  const configPath = "/home/user/.poe-code/config.json";
  let fs: FileSystem;

  beforeEach(async () => {
    fs = createMemFs();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
  });

  it("saves and loads a global default model", async () => {
    await saveDefaultModel({
      fs,
      filePath: configPath,
      key: "global",
      model: "anthropic/claude-sonnet-4.6"
    });

    const defaults = await loadDefaultModels({ fs, filePath: configPath });
    expect(defaults).toEqual({ global: "anthropic/claude-sonnet-4.6" });
  });

  it("saves and loads a tool-specific default model", async () => {
    await saveDefaultModel({
      fs,
      filePath: configPath,
      key: "codex",
      model: "openai/gpt-5.2-codex"
    });

    const defaults = await loadDefaultModels({ fs, filePath: configPath });
    expect(defaults).toEqual({ codex: "openai/gpt-5.2-codex" });
  });

  it("returns empty object when no default models are configured", async () => {
    const defaults = await loadDefaultModels({ fs, filePath: configPath });
    expect(defaults).toEqual({});
  });

  it("resolves tool-specific default before global", async () => {
    await saveDefaultModel({ fs, filePath: configPath, key: "global", model: "anthropic/claude-sonnet-4.6" });
    await saveDefaultModel({ fs, filePath: configPath, key: "codex", model: "openai/gpt-5.2-codex" });

    const model = await resolveDefaultModel({ fs, filePath: configPath, key: "codex" });
    expect(model).toBe("openai/gpt-5.2-codex");
  });

  it("falls back to global default when no tool-specific default exists", async () => {
    await saveDefaultModel({ fs, filePath: configPath, key: "global", model: "anthropic/claude-sonnet-4.6" });

    const model = await resolveDefaultModel({ fs, filePath: configPath, key: "codex" });
    expect(model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("returns null when no defaults are configured", async () => {
    const model = await resolveDefaultModel({ fs, filePath: configPath, key: "codex" });
    expect(model).toBeNull();
  });

  it("preserves api key and configured services when saving default model", async () => {
    await saveDefaultModel({
      fs,
      filePath: configPath,
      key: "global",
      model: "anthropic/claude-sonnet-4.6"
    });
    await saveConfig({ fs, filePath: configPath, apiKey: "sk-test" });

    const updated = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(updated.apiKey).toBe("sk-test");
    expect(updated.default_models).toEqual({ global: "anthropic/claude-sonnet-4.6" });
  });

  it("overwrites an existing default for the same key", async () => {
    await saveDefaultModel({ fs, filePath: configPath, key: "codex", model: "openai/gpt-5.2-codex" });
    await saveDefaultModel({ fs, filePath: configPath, key: "codex", model: "openai/gpt-5.3-codex" });

    const defaults = await loadDefaultModels({ fs, filePath: configPath });
    expect(defaults.codex).toBe("openai/gpt-5.3-codex");
  });
});
