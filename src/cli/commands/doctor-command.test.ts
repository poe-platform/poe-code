import { describe, it, expect, beforeEach, afterEach, onTestFinished, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { resolveConfigPath } from "@poe-code/poe-code-config/core";
import { createProgram } from "../program.js";
import { saveConfiguredService } from "../../services/config.js";
import { storeTestApiKey } from "../../../tests/test-helpers.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";
import type { CommandRunner } from "../../utils/command-checks.js";

const getThemeMock = vi.hoisted(() => vi.fn());

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    getTheme: getThemeMock
  };
});
function createIdentityTheme() {
  return {
    header: (t: string) => t,
    divider: (t: string) => t,
    prompt: (t: string) => t,
    number: (t: string) => t,
    intro: (t: string) => t,
    resolvedSymbol: "◇",
    errorSymbol: "■",
    accent: (t: string) => t,
    muted: (t: string) => t,
    success: (t: string) => t,
    warning: (t: string) => t,
    error: (t: string) => t,
    info: (t: string) => t
  };
}

const cwd = "/repo";
const homeDir = "/home/test";
const configPath = resolveConfigPath(homeDir);

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  volume.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createModelsResponse(models: Array<{ id: string; owned_by: string }>) {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      owned_by: model.owned_by,
      created: 1_700_000_000_000,
      supported_endpoints: ["/v1/chat/completions"],
      context_window: null,
      supported_features: [],
      pricing: null,
      architecture: null,
      reasoning: null,
      parameters: []
    }))
  };
}

interface RouterOptions {
  balance?: { ok: boolean; status?: number; body?: unknown };
  models?: { ok: boolean; status?: number; body?: unknown };
}

function createHttpClient(options: RouterOptions): HttpClient {
  return vi.fn(async (url: string) => {
    if (url.includes("/usage/current_balance")) {
      const balance = options.balance ?? { ok: true };
      return {
        ok: balance.ok,
        status: balance.status ?? (balance.ok ? 200 : 401),
        json: async () => balance.body ?? { current_point_balance: 8_432 },
        text: async () => ""
      };
    }
    const models = options.models ?? { ok: true };
    return {
      ok: models.ok,
      status: models.status ?? (models.ok ? 200 : 500),
      json: async () =>
        models.body ?? createModelsResponse([{ id: "Claude-Sonnet-4.5", owned_by: "Anthropic" }]),
      text: async () => ""
    };
  }) as unknown as HttpClient;
}

function createCommandRunner(foundBinaries: string[]): CommandRunner {
  return vi.fn(async (_command: string, args: string[]) => {
    const found = args.some((arg) => foundBinaries.includes(arg));
    return {
      exitCode: found ? 0 : 1,
      stdout: found ? `/usr/local/bin/${args.at(-1)}` : "",
      stderr: ""
    };
  }) as unknown as CommandRunner;
}

describe("doctor command", () => {
  let fs: FileSystem;
  let logs: string[];
  let originalPoeApiKey: string | undefined;
  let originalExitCode: number | string | undefined;

  beforeEach(() => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    onTestFinished(() => stdout.mockRestore());
    originalPoeApiKey = process.env.POE_API_KEY;
    delete process.env.POE_API_KEY;
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    fs = createMemfs();
    logs = [];
    getThemeMock.mockReturnValue(createIdentityTheme());
  });

  afterEach(() => {
    if (originalPoeApiKey === undefined) {
      delete process.env.POE_API_KEY;
    } else {
      process.env.POE_API_KEY = originalPoeApiKey;
    }
    process.exitCode = originalExitCode;
  });

  function createDoctorProgram(input: { httpClient: HttpClient; commandRunner?: CommandRunner }) {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient: input.httpClient,
      commandRunner: input.commandRunner ?? createCommandRunner([]),
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({
      yes: false,
      dryRun: false,
      verbose: false
    } as never);
    return program;
  }

  it("is registered in root help", async () => {
    const helpText = createDoctorProgram({ httpClient: createHttpClient({}) }).helpInformation();

    expect(helpText).toContain("doctor");
  });

  it("reports passing rows for auth, agents, model catalog and runtime", async () => {
    await storeTestApiKey(fs, homeDir, "sk-test");
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: { files: [], provider: "poe", model: "Claude-Sonnet-4.5" }
    });

    const program = createDoctorProgram({
      httpClient: createHttpClient({}),
      commandRunner: createCommandRunner(["claude"])
    });

    await program.parseAsync(["node", "cli", "doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("Logged in");
    expect(output).toContain("claude-code");
    expect(output).toContain("1 model available");
    expect(output).toContain("claude");
    expect(output).not.toContain("fail");
    expect(process.exitCode).toBeUndefined();
  });

  it("fails auth and agents rows with next actions when nothing is set up", async () => {
    const program = createDoctorProgram({ httpClient: createHttpClient({}) });

    await program.parseAsync(["node", "cli", "doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("Not logged in");
    expect(output).toContain("poe-code login");
    expect(output).toContain("No agents configured");
    expect(output).toContain("poe-code configure");
    expect(process.exitCode).toBe(1);
  });

  it("fails the model catalog row when the catalog is unreachable", async () => {
    await storeTestApiKey(fs, homeDir, "sk-test");

    const program = createDoctorProgram({
      httpClient: createHttpClient({ models: { ok: false, status: 503 } })
    });

    await program.parseAsync(["node", "cli", "doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("HTTP 503");
    expect(process.exitCode).toBe(1);
  });

  it("fails auth when the balance endpoint rejects the stored key", async () => {
    await storeTestApiKey(fs, homeDir, "revoked-key");

    const program = createDoctorProgram({
      httpClient: createHttpClient({ balance: { ok: false, status: 401 } })
    });

    await program.parseAsync(["node", "cli", "doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("Failed to check authentication (HTTP 401)");
    expect(output).toContain("poe-code login");
    expect(process.exitCode).toBe(1);
  });

  it("does not flag models of agents configured against another provider", async () => {
    await storeTestApiKey(fs, homeDir, "sk-test");
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: { files: [], provider: "anthropic", model: "claude-sonnet-4-5-20250929" }
    });

    const program = createDoctorProgram({
      httpClient: createHttpClient({}),
      commandRunner: createCommandRunner(["claude"])
    });

    await program.parseAsync(["node", "cli", "doctor"]);

    const output = logs.join("\n");
    expect(output).not.toContain("not in the Poe model catalog");
  });

  it("fails the runtime row when a configured agent binary is missing from PATH", async () => {
    await storeTestApiKey(fs, homeDir, "sk-test");
    await saveConfiguredService({
      fs,
      filePath: configPath,
      service: "claude-code",
      metadata: { files: [], provider: "poe", model: "Claude-Sonnet-4.5" }
    });

    const program = createDoctorProgram({
      httpClient: createHttpClient({}),
      commandRunner: createCommandRunner([])
    });

    await program.parseAsync(["node", "cli", "doctor"]);

    const output = logs.join("\n");
    expect(output).toContain("claude");
    expect(output).toContain("poe-code install");
    expect(process.exitCode).toBe(1);
  });
});
