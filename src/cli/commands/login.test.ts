import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeLogin } from "./login.js";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { saveConfiguredService } from "../../services/config.js";
import { resolveConfigPath } from "@poe-code/poe-code-config";
import type { FileSystem } from "../../utils/file-system.js";

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);

function createContainer(fs: FileSystem) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: () => {}
  });
}

describe("executeLogin", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("calls ProviderRegistry.login('poe', { apiKey }) with the resolved key", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();
    const program = createTestProgram();

    await executeLogin(program, container, { apiKey: "sk-test" });

    expect(loginSpy).toHaveBeenCalledWith("poe", { apiKey: "sk-test" });
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
});
