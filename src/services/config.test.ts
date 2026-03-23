import { describe, it, expect, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import type { FileSystem } from "../utils/file-system.js";
import {
  loadConfig,
  saveConfig,
  loadConfiguredServices,
  saveConfiguredService,
  unconfigureService
} from "./config.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("config store", () => {
  const configPath = resolveConfigPath("/home/user");
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
      core: {
        apiKey: "initial"
      },
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
    expect(updated.core.apiKey).toBe("updated");
    expect(updated.configured_services).toEqual(initial.configured_services);
  });

  it("migrates top-level apiKey into the core scope", async () => {
    await fs.writeFile(
      configPath,
      `${JSON.stringify({ apiKey: "legacy-key" }, null, 2)}\n`,
      {
        encoding: "utf8"
      }
    );

    await expect(
      loadConfig({
        fs,
        filePath: configPath
      })
    ).resolves.toBe("legacy-key");

    const migrated = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(migrated).toEqual({
      core: {
        apiKey: "legacy-key"
      }
    });
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
