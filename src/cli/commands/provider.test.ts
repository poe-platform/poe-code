import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import { createHomeFs, createTestProgram } from "../../../tests/test-helpers.js";
import { registerProviderCommand } from "./provider.js";
import { executeConfigure } from "./configure.js";
import type { FileSystem } from "../../utils/file-system.js";
import { resolveServicesConfigPath } from "@poe-code/poe-code-config/core";
import type { AuthProvider } from "@poe-code/providers";
import type { PromptFn } from "../types.js";
import { storeTestApiKey } from "../../../tests/test-helpers.js";
import { ValidationError } from "../errors.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(
  fs: FileSystem,
  logs: string[] = [],
  prompts: PromptFn = vi.fn().mockResolvedValue({}),
  envVars: Record<string, string | undefined> = {}
) {
  return createCliContainer({
    fs,
    prompts,
    env: { cwd, homeDir, variables: envVars },
    logger: (msg) => logs.push(msg)
  });
}

function setStdinTTY(value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value });
  return () => {
    if (original === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
      return;
    }
    Object.defineProperty(process.stdin, "isTTY", original);
  };
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
    baseUrlEnvVar: overrides.baseUrlEnvVar,
    auth: overrides.auth ?? {
      kind: "api-key",
      envVar: "TEST_API_KEY",
      storageKey: `provider:${overrides.id}`,
      prompt: { title: "Test API key" }
    },
    apiShapes: overrides.apiShapes
  };
}

// ─── provider list ────────────────────────────────────────────────────────────

describe("provider list", () => {
  let fs: FileSystem;

  beforeEach(() => {
    fs = createHomeFs(homeDir);
  });

  it("renders the provider list when invoked bare, without printing help", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider"]);

    const output = logs.join("\n");
    expect(output).toContain("poe");
    expect(output).not.toContain("Usage: poe-code provider");
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

  it("prints provider rows as JSON with --json and skips the table", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(true);
    vi.spyOn(container.providerRegistry, "list").mockReturnValue([
      makeProvider({
        id: "shape-only",
        baseUrlEnvVar: "SHAPE_ONLY_BASE_URL",
        apiShapes: [{ id: "openai-responses", defaultBaseUrl: "https://api.test/v1" }]
      })
    ]);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list", "--json"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    stdoutSpy.mockRestore();

    expect(JSON.parse(written)).toEqual([
      {
        id: "shape-only",
        loggedIn: true,
        env: ["TEST_API_KEY", "SHAPE_ONLY_BASE_URL"],
        apiShapes: ["openai-responses"],
        agents: expect.any(Array)
      }
    ]);
    expect(logs).toEqual([]);
  });

  it("prints untruncated agent lists in provider list --json", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list", "--json"]);

    const written = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    stdoutSpy.mockRestore();

    const parsed = JSON.parse(written) as Array<{ id: string; agents: string[] }>;
    const poe = parsed.find((entry) => entry.id === "poe");
    expect(poe?.agents.length).toBeGreaterThan(0);
    expect(written).not.toContain("…");
    expect(written).not.toContain("\u001b[");
  });

  it("documents --json on provider list help", async () => {
    const container = createContainer(fs, []);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    const listCommand = program
      .commands.find((command) => command.name() === "provider")
      ?.commands.find((command) => command.name() === "list");

    expect(listCommand?.helpInformation()).toContain("--json");
  });

  it("keeps every table line inside the terminal width", async () => {
    const columnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: 60 });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);

    try {
      const program = createBaseProgram();
      registerProviderCommand(program, container);

      await program.parseAsync(["node", "cli", "provider", "list"]);

      const tableLines = logs
        .join("\n")
        .replaceAll(/\u001b\[[0-9;]*m/g, "")
        .split("\n")
        .filter((line) => line.includes("│") || line.includes("┌"));

      expect(tableLines.length).toBeGreaterThan(0);
      // 60 columns minus the logger's "│  " gutter.
      expect(Math.max(...tableLines.map((line) => line.length))).toBeLessThanOrEqual(57);
    } finally {
      if (columnsDescriptor) {
        Object.defineProperty(process.stdout, "columns", columnsDescriptor);
      } else {
        delete (process.stdout as { columns?: number }).columns;
      }
    }
  });

  it("does not migrate legacy credentials while previewing provider list", async () => {
    await storeTestApiKey(fs, homeDir, "legacy-key");
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "provider", "list"]);

    expect(logs.join("\n")).toMatch(/logged in/i);
    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["credentials.enc"]);
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

  it("derives agents from provider API shapes", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    vi.spyOn(container.providerRegistry, "list").mockReturnValue([
      makeProvider({
        id: "shape-only",
        baseUrlEnvVar: "SHAPE_ONLY_BASE_URL",
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
    expect(output).toContain("TEST_API_KEY, SHAPE_ONLY_BASE_URL");
    expect(output).toContain("responses");
    expect(output).toContain("codex, poe-agent");
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

  it("leaves the agent column empty when provider API shapes are absent", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "isLoggedIn").mockResolvedValue(false);
    vi.spyOn(container.providerRegistry, "list").mockReturnValue([
      makeProvider({
        id: "shape-missing"
      })
    ]);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "list"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toContain("shape-missing");
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

  it.each(["login", "logout"])(
    "reports an unknown provider on %s as a user error keeping the provider list hint",
    async (subcommand) => {
      const container = createContainer(fs);
      const program = createBaseProgram();
      registerProviderCommand(program, container);

      const error = await program
        .parseAsync(["node", "cli", "--yes", "provider", subcommand, "not-a-provider"])
        .then(
          () => undefined,
          (thrown: unknown) => thrown
        );

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).isUserError).toBe(true);
      expect((error as ValidationError).message).toBe(
        'Unknown provider "not-a-provider". Run `poe-code provider list` to see available providers.'
      );
    }
  );

  it("warns about shell history and names the provider env var when --api-key is passed", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    vi.spyOn(container.providerRegistry, "login").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "login", "poe", "--api-key", "sk-secret"]);

    const output = stripAnsi(logs.join("\n"));
    expect(output).toMatch(/shell history/i);
    expect(output).toContain("POE_API_KEY");
    expect(output).not.toContain("sk-secret");

    const help = program.commands
      .find((command) => command.name() === "provider")
      ?.commands.find((command) => command.name() === "login")
      ?.helpInformation() ?? "";
    expect(help).toMatch(/shell history/i);
  });

  it("fails without prompting when --yes has no provider credential", async () => {
    const prompts = vi.fn();
    const container = createContainer(fs, [], prompts);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--yes", "provider", "login", "anthropic"])
    ).rejects.toThrow('No API key available for provider "anthropic"');

    expect(prompts).not.toHaveBeenCalled();
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

  it("previews stored base URLs during dry-run provider login", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--dry-run",
      "--yes",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-preview",
      "--base-url",
      "https://gateway.example.test"
    ]);

    expect(logs.join("\n")).toContain("services.json");
    await expect(fs.stat(resolveServicesConfigPath(homeDir))).rejects.toBeTruthy();
  });

  it("rejects missing required credentials during non-interactive dry-run login", async () => {
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "--yes", "provider", "login", "cloudflare", "--base-url", "https://gateway.example.test"])
    ).rejects.toThrow('No API key available for provider "cloudflare"');
  });

  it("previews preferred authentication instead of claiming a Poe credential was saved", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "--yes", "provider", "login", "poe"]);

    expect(logs.join("\n")).toContain("Dry run: would authenticate with Poe.");
    expect(logs.join("\n")).not.toContain("would save credential for poe");
  });

  it("reuses the stored credential with --yes for preferred-login providers", async () => {
    const container = createContainer(fs);
    await container.writeApiKey("sk-stored");
    const prompts = vi.fn();
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "provider", "login", "poe"]);

    await expect(container.providerRegistry.resolveCredential("poe")).resolves.toBe("sk-stored");
    expect(prompts).not.toHaveBeenCalled();
  });

  it("requires a fresh credential for preferred-login providers without --yes", async () => {
    const container = createContainer(fs);
    await container.writeApiKey("sk-stored");
    const resolveSpy = vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-fresh");
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "login", "poe"]);

    expect(resolveSpy).toHaveBeenCalledWith(expect.objectContaining({ allowStored: false }));
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

  it("does not persist a credential when provider endpoint storage fails", async () => {
    const container = createContainer(fs);
    await fs.writeFile(`${homeDir}/.config`, "not a directory", { encoding: "utf8" });

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "provider",
        "login",
        "cloudflare",
        "--api-key",
        "sk-cloudflare-test",
        "--base-url",
        "https://gateway.example.test"
      ])
    ).rejects.toThrow();

    await expect(container.providerRegistry.resolveCredential("cloudflare")).rejects.toThrow();
  });

  it("does not rotate Poe credentials when provider endpoint storage fails", async () => {
    const container = createContainer(fs);
    await container.writeApiKey("sk-old");
    vi.spyOn(container.options, "resolveApiKey").mockImplementation(async (input) => {
      if (!input.dryRun) {
        await container.writeApiKey("sk-new");
      }
      return "sk-new";
    });
    await fs.writeFile(`${homeDir}/.config`, "not a directory", { encoding: "utf8" });

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "--yes",
        "provider",
        "login",
        "poe",
        "--api-key",
        "sk-new",
        "--shape-base-url",
        "anthropic-messages=https://example.test/anthropic"
      ])
    ).rejects.toThrow();

    await expect(container.readApiKey()).resolves.toBe("sk-old");
  });

  it("refreshes configured service credentials after provider key rotation", async () => {
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-old",
      "--base-url",
      "https://gateway.example.test"
    ]);
    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "cloudflare"
    });

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-new",
      "--base-url",
      "https://gateway.example.test"
    ]);

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_CUSTOM_HEADERS).toBe("Authorization: Bearer sk-new");
  });

  it("refreshes configured service endpoints after provider base URL updates", async () => {
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-cloudflare-test",
      "--base-url",
      "https://old-gateway.example.test"
    ]);
    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "cloudflare"
    });

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-cloudflare-test",
      "--base-url",
      "https://new-gateway.example.test"
    ]);

    const settings = JSON.parse(await fs.readFile(`${homeDir}/.claude/settings.json`, "utf8"));
    expect(settings.env.ANTHROPIC_BASE_URL).toBe("https://new-gateway.example.test/anthropic");
  });

  it("prompts for Cloudflare credentials and stores shape URLs from a gateway base URL", async () => {
    const gatewayRoot =
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/";
    const prompts = vi.fn(async (descriptor) => {
      if (descriptor.name === "apiKey") {
        return { apiKey: "sk-cloudflare-prompt" };
      }
      if (descriptor.name === "baseUrl") {
        return { baseUrl: gatewayRoot };
      }
      return {};
    });
    const container = createContainer(fs, [], prompts, {
      CF_AIG_TOKEN: "sk-cloudflare-env"
    });

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "login", "cloudflare"]);

    expect(prompts).toHaveBeenCalledWith({
      name: "apiKey",
      message: "Cloudflare AI Gateway token",
      type: "password"
    });
    expect(prompts).toHaveBeenCalledWith({
      name: "baseUrl",
      message: "Cloudflare AI Gateway base URL",
      type: "text"
    });
    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.cloudflare.shapeBaseUrls).toEqual({
      "anthropic-messages": `${gatewayRoot}anthropic`,
      "google-generations": `${gatewayRoot}google-ai-studio`,
      "openai-chat-completions": `${gatewayRoot}compat`,
      "openai-responses": `${gatewayRoot}openai`
    });
  });

  it("re-prompts when the interactive Cloudflare provider base URL is invalid", async () => {
    const gatewayRoot =
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/";
    const baseUrlAnswers = [
      `"${gatewayRoot}compat",`,
      gatewayRoot
    ];
    const prompts = vi.fn(async (descriptor) => {
      if (descriptor.name === "apiKey") {
        return { apiKey: "sk-cloudflare-prompt" };
      }
      if (descriptor.name === "baseUrl") {
        return { baseUrl: baseUrlAnswers.shift() };
      }
      return {};
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs, prompts);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "login", "cloudflare"]);

    const baseUrlPrompts = prompts.mock.calls.filter(
      ([descriptor]) => descriptor.name === "baseUrl"
    );
    expect(baseUrlPrompts).toHaveLength(2);
    expect(logs.join("\n")).toContain("Base URL must start with http:// or https://");
    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.cloudflare.shapeBaseUrls["openai-responses"]).toBe(
      `${gatewayRoot}openai`
    );
  });

  it("stores Cloudflare shape URLs from --base-url", async () => {
    const gatewayRoot =
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/compat";
    const container = createContainer(fs);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-cloudflare-test",
      "--base-url",
      gatewayRoot
    ]);

    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.cloudflare.shapeBaseUrls["openai-chat-completions"]).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/compat"
    );
    expect(saved.providers.cloudflare.shapeBaseUrls["openai-responses"]).toBe(
      "https://gateway.ai.cloudflare.com/v1/fdb283a7279a7b4d1f3577dbb2089ff2/poe-ai-gateway/openai"
    );
  });

  it("stores Poe shape URLs from --base-url using Poe API shape paths", async () => {
    const container = createContainer(fs);
    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "poe",
      "--api-key",
      "sk-test",
      "--base-url",
      "https://proxy.example/v1"
    ]);

    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.poe.shapeBaseUrls).toEqual({
      "anthropic-messages": "https://proxy.example/anthropic",
      "openai-chat-completions": "https://proxy.example/v1",
      "openai-responses": "https://proxy.example/v1"
    });
  });

  it("preserves explicit shape URLs over Cloudflare --base-url defaults", async () => {
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "provider",
      "login",
      "cloudflare",
      "--api-key",
      "sk-cloudflare-test",
      "--base-url",
      "https://gateway.example.test",
      "--shape-base-url",
      "openai-responses=https://specific-responses.example.test/v1"
    ]);

    const saved = JSON.parse(await fs.readFile(resolveServicesConfigPath(homeDir), "utf8"));
    expect(saved.providers.cloudflare.shapeBaseUrls["openai-responses"]).toBe(
      "https://specific-responses.example.test/v1"
    );
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

  it("rejects invalid shape base URLs before login or config writes", async () => {
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
        "anthropic-messages=not-a-url"
      ])
    ).rejects.toThrow('Provider "poe" base URL must be an http(s) URL.');
    expect(loginSpy).not.toHaveBeenCalled();
    await expect(fs.stat(resolveServicesConfigPath(homeDir))).rejects.toBeTruthy();
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

    await program.parseAsync(["node", "cli", "--yes", "provider", "logout", "poe"]);

    expect(logoutSpy).toHaveBeenCalledWith("poe", { store: expect.any(Object) });
  });

  it("uses a preview store when logging out in dry-run mode", async () => {
    const container = createContainer(fs);
    const logoutSpy = vi.spyOn(container.providerRegistry, "logout").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--dry-run", "provider", "logout", "poe"]);

    expect(logoutSpy).toHaveBeenCalledWith("poe", { store: expect.any(Object) });
  });

  it("previews stored credential deletion during dry-run logout", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "provider", "login", "anthropic", "--api-key", "sk-test"]);
    await program.parseAsync(["node", "cli", "--dry-run", "provider", "logout", "anthropic"]);

    expect(logs.join("\n")).toContain("credentials.anthropic.enc");
    await expect(fs.stat(`${homeDir}/.poe-code/credentials.anthropic.enc`)).resolves.toBeTruthy();
  });

  it("removes provider credentials deployed into configured service files", async () => {
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync([
      "node",
      "cli",
      "--yes",
      "provider",
      "login",
      "anthropic",
      "--api-key",
      "sk-anthropic-test"
    ]);
    await executeConfigure(createTestProgram(["node", "cli", "--yes"]), container, "claude-code", {
      provider: "anthropic"
    });

    await program.parseAsync(["node", "cli", "--yes", "provider", "logout", "anthropic"]);

    await expect(fs.stat(`${homeDir}/.claude/settings.json`)).rejects.toThrow();
  });

  it("warns when an environment credential remains after logout", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs, vi.fn().mockResolvedValue({}), {
      CF_AIG_TOKEN: "environment-secret"
    });

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "provider", "logout", "cloudflare"]);

    expect(logs.some((line) => line.includes("CF_AIG_TOKEN"))).toBe(true);
    expect(logs.some((line) => line.includes("Logged out from cloudflare."))).toBe(false);
  });

  it("throws for unknown provider id", async () => {
    const container = createContainer(fs);

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    await expect(program.parseAsync(["node", "cli", "provider", "logout", "nope"])).rejects.toThrow(
      /unknown provider/i
    );
  });

  it("documents the danger and --yes requirement in provider logout help", async () => {
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerProviderCommand(program, container);

    const logoutCommand = program.commands
      .find((command) => command.name() === "provider")
      ?.commands.find((command) => command.name() === "logout");

    expect(logoutCommand?.description().toLowerCase()).toContain("danger");
    expect(logoutCommand?.description()).toContain("--yes");
  });

  it("refuses to log out without --yes in non-interactive mode and names the credential", async () => {
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const logoutSpy = vi.spyOn(container.providerRegistry, "logout").mockResolvedValue();

    const program = createBaseProgram();
    registerProviderCommand(program, container);

    const restore = setStdinTTY(false);
    try {
      await expect(
        program.parseAsync(["node", "cli", "provider", "logout", "anthropic"])
      ).rejects.toThrow(
        "provider logout anthropic requires --yes when running without an interactive TTY."
      );
    } finally {
      restore();
    }

    expect(logoutSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("credentials.anthropic.enc");
  });
});
