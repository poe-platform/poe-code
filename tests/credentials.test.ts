import { describe, it, expect, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import type { FileSystem } from "../src/utils/file-system.js";
import {
  loadCredentials,
  saveCredentials,
  loadConfiguredServices,
  saveConfiguredService,
  unconfigureService
} from "../src/services/credentials.js";

function createMemFs(): FileSystem {
  const vol = new Volume();
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

describe("credentials store", () => {
  const credentialsPath = "/home/user/.poe-code/credentials.json";
  let fs: FileSystem;

  beforeEach(async () => {
    fs = createMemFs();
    await fs.mkdir(path.dirname(credentialsPath), { recursive: true });
  });

  it("returns stored api key when file is valid json", async () => {
    await saveCredentials({
      fs,
      filePath: credentialsPath,
      apiKey: "test-key"
    });

    const apiKey = await loadCredentials({
      fs,
      filePath: credentialsPath
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
    await fs.writeFile(credentialsPath, JSON.stringify(initial, null, 2), {
      encoding: "utf8"
    });

    await saveCredentials({
      fs,
      filePath: credentialsPath,
      apiKey: "updated"
    });

    const updated = JSON.parse(
      await fs.readFile(credentialsPath, "utf8")
    );
    expect(updated.apiKey).toBe("updated");
    expect(updated.configured_services).toEqual(initial.configured_services);
  });

  it("stores configured service metadata and returns it on load", async () => {
    await saveConfiguredService({
      fs,
      filePath: credentialsPath,
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
      filePath: credentialsPath
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
      filePath: credentialsPath,
      service: "claude-code",
      metadata: {
        files: ["/home/user/.claude/settings.json"]
      }
    });

    await unconfigureService({
      fs,
      filePath: credentialsPath,
      service: "claude-code"
    });

    const services = await loadConfiguredServices({
      fs,
      filePath: credentialsPath
    });
    expect(services).toEqual({});
  });

  it("backs up and resets invalid json content", async () => {
    await fs.writeFile(credentialsPath, "test\n", { encoding: "utf8" });

    const apiKey = await loadCredentials({
      fs,
      filePath: credentialsPath
    });

    expect(apiKey).toBeNull();

    const credentialsDir = path.dirname(credentialsPath);
    const entries = await fs.readdir(credentialsDir);
    const backupName = entries.find((entry) =>
      entry.startsWith("credentials.json.invalid-")
    );
    expect(backupName).toBeDefined();

    const backupPath = path.join(credentialsDir, backupName as string);
    const backupContent = await fs.readFile(backupPath, "utf8");
    expect(backupContent).toBe("test\n");

    const rewritten = await fs.readFile(credentialsPath, "utf8");
    expect(JSON.parse(rewritten)).toEqual({});
  });
});
