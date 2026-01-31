import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCliContainer } from "./container.js";
import type { FileSystem } from "../utils/file-system.js";
import { createHomeFs } from "../../tests/test-helpers.js";
import { ensureIsolatedConfigForService } from "./commands/ensure-isolated-config.js";

const cwd = "/repo";
const homeDir = "/home/test";

describe("ensureIsolatedConfigForService", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("creates Codex isolated config without touching ~/.codex", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

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
      flags: { dryRun: false, assumeYes: true }
    });

    await expect(
      fs.stat(`${homeDir}/.poe-code/codex/config.toml`)
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(`${homeDir}/.codex/config.toml`)
    ).rejects.toBeTruthy();
  });

  it("creates OpenCode isolated config without touching ~/.config/opencode", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const adapter = container.registry.require("opencode");

    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "opencode",
      flags: { dryRun: false, assumeYes: true }
    });

    await expect(
      fs.stat(`${homeDir}/.poe-code/opencode/.config/opencode/config.json`)
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(`${homeDir}/.config/opencode/config.json`)
    ).rejects.toBeTruthy();
  });

  it("refreshes isolated config when requested", async () => {
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-new");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    vi.spyOn(container.options, "resolveReasoning").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const configPath = `${homeDir}/.poe-code/codex/config.toml`;
    await fs.mkdir(`${homeDir}/.poe-code/codex`, { recursive: true });
    const initialConfig = [
      'model_provider = "poe"',
      'model = "o1-mini"',
      'model_reasoning_effort = "low"',
      "",
      "[model_providers.poe]",
      'name = "poe"',
      'base_url = "https://old.example"',
      'wire_api = "chat"',
      'experimental_bearer_token = "sk-old"',
      ""
    ].join("\n");
    await fs.writeFile(configPath, initialConfig, { encoding: "utf8" });

    const before = await fs.readFile(configPath, "utf8");
    expect(before).toContain('experimental_bearer_token = "sk-old"');

    const adapter = container.registry.require("codex");

    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: { dryRun: false, assumeYes: true },
      refresh: true
    });

    const after = await fs.readFile(configPath, "utf8");
    expect(after).toContain('experimental_bearer_token = "sk-new"');
  });
});
