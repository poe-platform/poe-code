import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import { createHomeFs } from "../../../tests/test-helpers.js";
import { registerProviderCommand } from "./provider.js";
import type { FileSystem } from "../../utils/file-system.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(fs: FileSystem, logs: string[] = []) {
  return createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd, homeDir },
    logger: (msg) => logs.push(msg)
  });
}

// ─── provider list ────────────────────────────────────────────────────────────

describe("provider list", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("renders provider rows with logged-in status when logged in", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = logs.join("\n");
    expect(output).toContain("poe");
    expect(output).toMatch(/logged in/i);
  });

  it("renders [-] status when provider is not logged in", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = logs.join("\n");
    expect(output).toContain("poe");
    expect(output).toContain("[-]");
  });

  it("renders supported agents in the agents column", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = logs.join("\n");
    expect(output).toContain("claude-code");
  });
});

// ─── provider login ───────────────────────────────────────────────────────────

describe("provider login", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("calls ProviderRegistry.login(id, { apiKey }) with the resolved key", async () => {
    const container = createContainer(fs);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "login", "poe", "--api-key", "sk-test"]);

    expect(loginSpy).toHaveBeenCalledWith("poe", { apiKey: "sk-test" }, expect.any(Object));
  });

  it("does not call ProviderRegistry.login in dry-run mode", async () => {
    const container = createContainer(fs);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "provider", "login", "poe", "--api-key", "sk-test"]);

    expect(loginSpy).not.toHaveBeenCalled();
  });
});

// ─── provider logout ──────────────────────────────────────────────────────────

describe("provider logout", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("calls ProviderRegistry.logout(id)", async () => {
    const container = createContainer(fs);
    const logoutSpy = vi.spyOn(container.providerRegistry, "logout").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "logout", "poe"]);

    expect(logoutSpy).toHaveBeenCalledWith("poe");
  });

  it("does not call ProviderRegistry.logout in dry-run mode", async () => {
    const container = createContainer(fs);
    const logoutSpy = vi.spyOn(container.providerRegistry, "logout").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "provider", "logout", "poe"]);

    expect(logoutSpy).not.toHaveBeenCalled();
  });

  it("throws for unknown provider id", async () => {
    const container = createContainer(fs);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "provider", "logout", "nope"])
    ).rejects.toThrow(/unknown provider/i);
  });
});
