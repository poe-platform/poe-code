import { describe, it, expect, vi, beforeEach } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { ensureIsolatedConfigForService } from "./ensure-isolated-config.js";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import type { CommandFlags } from "./shared.js";
import { saveConfiguredService } from "../../services/config.js";

const cwd = "/repo";
const homeDir = "/home/test";

const defaultFlags: CommandFlags = { dryRun: false, assumeYes: true, verbose: false };

function createMemFs(): FileSystem {
  const vol = new Volume();
  vol.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(vol).promises as unknown as FileSystem;
}

function createContainer(fs: FileSystem) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

describe("ensureIsolatedConfigForService — provider resolution", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createMemFs();
  });

  it("uses the provider from services.json when the service is configured", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    vi.spyOn(container.options, "resolveReasoning").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    await saveConfiguredService({
      fs,
      filePath: container.env.configPath,
      service: "codex",
      metadata: { files: [], provider: "poe" }
    });

    const adapter = container.registry.require("codex");
    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: defaultFlags
    });

    await expect(
      fs.stat(`${homeDir}/.poe-code/codex/config.toml`)
    ).resolves.toBeTruthy();
  });

  it("falls back to the single registered provider when service not in services.json", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    vi.spyOn(container.options, "resolveReasoning").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const adapter = container.registry.require("codex");
    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: defaultFlags
    });

    await expect(
      fs.stat(`${homeDir}/.poe-code/codex/config.toml`)
    ).resolves.toBeTruthy();
  });

  it("skips config creation when no provider can be resolved", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.providerRegistry, "forAgent").mockReturnValue([]);

    const adapter = container.registry.require("codex");
    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: defaultFlags
    });

    await expect(
      fs.stat(`${homeDir}/.poe-code/codex/config.toml`)
    ).rejects.toBeTruthy();
  });

  it("skips when isolated config already exists and refresh is not requested", async () => {
    const container = createContainer(fs);
    const resolveApiKey = vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const configPath = `${homeDir}/.poe-code/codex/config.toml`;
    await fs.mkdir(`${homeDir}/.poe-code/codex`, { recursive: true });
    await fs.writeFile(configPath, "[config]\n", { encoding: "utf8" });

    const adapter = container.registry.require("codex");
    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: defaultFlags
    });

    expect(resolveApiKey).not.toHaveBeenCalled();
  });
});
