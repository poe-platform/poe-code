import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import { createHomeFs } from "../../../tests/test-helpers.js";
import { registerProviderCommand } from "./provider.js";
import type { FileSystem } from "../../utils/file-system.js";
import { resolveServicesConfigPath } from "@poe-code/poe-code-config";
import type { AuthProvider } from "@poe-code/providers";

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

function stripAnsi(input: string): string {
  let result = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === "\u001b" && input[index + 1] === "[") {
      index += 2;
      while (index < input.length && input[index] !== "m") {
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }

  return result;
}

function makeProvider(overrides: Partial<AuthProvider> & Pick<AuthProvider, "id">): AuthProvider {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    baseUrl: overrides.baseUrl ?? "https://api.test",
    auth: overrides.auth ?? {
      kind: "api-key",
      envVar: "TEST_API_KEY",
      storageKey: `provider:${overrides.id}`,
      prompt: { title: "Test API key" }
    },
    supportsAgents: overrides.supportsAgents ?? [],
    apiShapes: overrides.apiShapes
  };
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

  it("snapshots provider shape and agent columns", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = stripAnsi(logs.join("\n"));
    const tableLines = output
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("┌") ||
          line.startsWith("│") ||
          line.startsWith("├") ||
          line.startsWith("└")
      );

    expect(new Set(tableLines.map((line) => line.length))).toHaveLength(1);
    expect(output).toMatchSnapshot();
  });

  it("derives agents from provider API shapes without reading supportsAgents", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    vi.spyOn(container.providerRegistry, "list").mockReturnValue([
      makeProvider({
        id: "shape-only",
        supportsAgents: ["unsupported-agent"],
        apiShapes: [
          {
            id: "openai-responses",
            defaultBaseUrl: "https://api.test/v1"
          }
        ]
      })
    ]);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("responses");
    expect(output).toContain("codex, poe-agent");
    expect(output).not.toContain("unsupported-agent");
  });

  it("renders every canonical API shape with its short CLI label", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    vi.spyOn(container.providerRegistry, "list").mockReturnValue([
      makeProvider({
        id: "all-shapes",
        apiShapes: [
          { id: "openai-chat-completions", defaultBaseUrl: "https://api.test/chat" },
          { id: "openai-responses", defaultBaseUrl: "https://api.test/responses" },
          { id: "anthropic-messages", defaultBaseUrl: "https://api.test/messages" },
          { id: "google-generations", defaultBaseUrl: "https://api.test/generations" }
        ]
      })
    ]);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("chat-completions, responses, messages, generations");
  });

  it("does not list legacy supportsAgents when provider API shapes are absent", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    vi.spyOn(container.providerRegistry, "list").mockReturnValue([
      makeProvider({
        id: "legacy-only",
        supportsAgents: ["claude-code", "codex"]
      })
    ]);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("legacy-only");
    expect(output).not.toContain("claude-code");
    expect(output).not.toContain("codex");
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
