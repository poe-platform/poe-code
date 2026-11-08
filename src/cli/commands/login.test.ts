import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeLogin, registerLoginCommand } from "./login.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { saveConfiguredService } from "../../services/config.js";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import type { FileSystem } from "../../utils/file-system.js";
import { parseToml } from "@poe-code/config-mutations/testing";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);

function createContainer(fs: FileSystem, logs: string[] = []) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (message) => logs.push(message)
  });
}

describe("executeLogin", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("documents POE_API_KEY as the preferred path on login --api-key help", async () => {
    const program = createTestProgram();
    registerLoginCommand(program, createContainer(fs));

    const help = program.commands.find((command) => command.name() === "login")?.helpInformation() ?? "";

    expect(help).toContain("POE_API_KEY");
    expect(help).toMatch(/shell history/i);
  });

  it("stores the resolved key", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const program = createTestProgram();

    await executeLogin(program, container, { apiKey: "sk-test" });

    await expect(container.readApiKey()).resolves.toBe("sk-test");
  });

  it("warns that --api-key leaks into shell history and points at POE_API_KEY", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const program = createTestProgram();

    await executeLogin(program, container, { apiKey: "sk-test" });

    const output = logs.join("\n");
    expect(output).toMatch(/shell history/i);
    expect(output).toContain("POE_API_KEY");
    expect(output).not.toContain("sk-test");
  });

  it("does not warn about --api-key when the flag is omitted", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const program = createTestProgram();

    await executeLogin(program, container, {});

    expect(logs.join("\n")).not.toMatch(/shell history/i);
  });

  it("does not call ProviderRegistry.login in dry-run mode", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    const program = createTestProgram(["node", "cli", "--dry-run"]);

    await executeLogin(program, container, { apiKey: "sk-test" });

    expect(loginSpy).not.toHaveBeenCalled();
  });

  it("only reconfigures services with provider === 'poe'", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    const invokeSpy = vi.spyOn(container.registry, "invoke").mockResolvedValue();
    const program = createTestProgram();

    await saveConfiguredService({ fs, filePath: configPath, service: "claude-code", metadata: { files: [], provider: "poe" } });
    await saveConfiguredService({ fs, filePath: configPath, service: "codex", metadata: { files: [], provider: "anthropic" } });

    await executeLogin(program, container, { apiKey: "sk-test" });

    const invokedNames = invokeSpy.mock.calls.map((c) => c[0]);
    expect(invokedNames).toContain("claude-code");
    expect(invokedNames).not.toContain("codex");
  });

  it("reconfigures all poe services (backward compat with migrated entries)", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    const invokeSpy = vi.spyOn(container.registry, "invoke").mockResolvedValue();
    const program = createTestProgram();

    await saveConfiguredService({ fs, filePath: configPath, service: "claude-code", metadata: { files: [], provider: "poe" } });
    await saveConfiguredService({ fs, filePath: configPath, service: "codex", metadata: { files: [], provider: "poe" } });

    await executeLogin(program, container, { apiKey: "sk-test" });

    const invokedNames = invokeSpy.mock.calls.map((c) => c[0]);
    expect(invokedNames).toContain("claude-code");
    expect(invokedNames).toContain("codex");
  });

  it("does not restore obsolete codex model preferences while rotating Poe credentials", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-new");
    vi.spyOn(container.providerRegistry, "login").mockResolvedValue();

    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: {
        files: [],
        provider: "poe",
        model: "configured-codex",
        reasoningEffort: "high"
      }
    });

    await executeLogin(createTestProgram(), container, { apiKey: "sk-new" });

    const globalConfig = parseToml(await fs.readFile(`${homeDir}/.codex/config.toml`, "utf8"));
    const isolatedConfig = parseToml(await fs.readFile(`${homeDir}/.poe-code/codex/config.toml`, "utf8"));
    expect(globalConfig.model).toBeUndefined();
    expect(globalConfig.model_reasoning_effort).toBe("high");
    expect(isolatedConfig.model).toBeUndefined();
    expect(isolatedConfig.model_reasoning_effort).toBe("high");
  });

  it("does not persist credential rotation when a configured rewrite fails", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-new");
    await container.writeApiKey("sk-old");
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: { files: [], provider: "poe", model: "configured-codex", reasoningEffort: "high" }
    });
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "opencode",
      metadata: { files: [], provider: "poe", model: "configured-open" }
    });
    await fs.mkdir(`${homeDir}/.poe-code/opencode`, { recursive: true });
    await fs.writeFile(`${homeDir}/.poe-code/opencode/.config`, "blocked", { encoding: "utf8" });

    await expect(executeLogin(createTestProgram(), container, { apiKey: "sk-new" })).rejects.toThrow();

    await expect(container.readApiKey()).resolves.toBe("sk-old");
    await expect(fs.readFile(`${homeDir}/.codex/config.toml`, "utf8")).rejects.toThrow();
  });

  it("rolls back earlier writes when committing a later rewrite fails", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-new");
    await container.writeApiKey("sk-old");
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "codex",
      metadata: { files: [], provider: "poe", model: "configured-codex", reasoningEffort: "high" }
    });
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "opencode",
      metadata: { files: [], provider: "poe", model: "configured-open" }
    });
    await fs.mkdir(`${homeDir}/.codex`, { recursive: true });
    await fs.mkdir(`${homeDir}/.poe-code/codex`, { recursive: true });
    await fs.writeFile(`${homeDir}/.codex/config.toml`, "before-global", { encoding: "utf8" });
    await fs.writeFile(`${homeDir}/.poe-code/codex/config.toml`, "before-isolated", { encoding: "utf8" });
    const writeFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (filePath.includes("/.config/opencode/config.json") && !filePath.includes(".mutation-tmp-")) {
        throw new Error("write failed");
      }
      return writeFile(filePath, data, options);
    });

    await expect(executeLogin(createTestProgram(), container, { apiKey: "sk-new" })).rejects.toThrow("write failed");

    await expect(container.readApiKey()).resolves.toBe("sk-old");
    await expect(fs.readFile(`${homeDir}/.codex/config.toml`, "utf8")).resolves.toBe("before-global");
    await expect(fs.readFile(`${homeDir}/.poe-code/codex/config.toml`, "utf8")).resolves.toBe("before-isolated");
  });
});
