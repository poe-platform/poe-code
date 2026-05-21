import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import { createHomeFs } from "../../../tests/test-helpers.js";
import { registerProviderCommand } from "./provider.js";
import type { FileSystem } from "../../utils/file-system.js";
import { resolveServicesConfigPath } from "@poe-code/poe-code-config";

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

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "provider",
      "login",
      "poe",
      "--api-key",
      "sk-test"
    ]);

    expect(loginSpy).not.toHaveBeenCalled();
  });

  it("stores per-shape base URLs outside the credential store", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      "anthropic-messages=https://example/anth"
    ]);

    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.poe.shapeBaseUrls).toEqual({
      "anthropic-messages": "https://example/anth"
    });
  });

  it("stores repeated per-shape base URLs", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      "anthropic-messages=https://example/anth",
      "--shape-base-url",
      "openai-responses=https://example/responses"
    ]);

    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.poe.shapeBaseUrls).toEqual({
      "anthropic-messages": "https://example/anth",
      "openai-responses": "https://example/responses"
    });
  });

  it("trims shape ids and base URLs before storing", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "provider",
      "login",
      "poe",
      "--shape-base-url",
      " anthropic-messages = https://example/anth "
    ]);

    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.poe.shapeBaseUrls).toEqual({
      "anthropic-messages": "https://example/anth"
    });
  });

  it("rejects unknown shape ids and lists the provider shapes", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    let message = "";
    try {
      await program.parseAsync([
        "node",
        "cli",
        "provider",
        "login",
        "poe",
        "--shape-base-url",
        "missing-shape=https://example/missing"
      ]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Unknown API shape "missing-shape" for provider "poe".');
    expect(message).toContain("Exposed shapes:");
    expect(message).toContain("anthropic-messages");
  });

  it("rejects malformed shape base URL values before login", async () => {
    const container = createContainer(fs);
    const loginSpy = vi.spyOn(container.providerRegistry, "login").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "provider",
        "login",
        "poe",
        "--shape-base-url",
        "anthropic-messages"
      ])
    ).rejects.toThrow('Invalid --shape-base-url value "anthropic-messages"');
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

    await expect(program.parseAsync(["node", "cli", "provider", "logout", "nope"])).rejects.toThrow(
      /unknown provider/i
    );
  });
});
