import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import type { CliContainer } from "../container.js";
import type { FileSystem } from "../utils/file-system.js";
import type { LlmClient } from "../../services/llm-client.js";

const client = vi.hoisted<LlmClient>(() => ({
  text: vi.fn(async () => ({ content: "generated" })),
  media: vi.fn(async () => ({}))
}));
const initializeClient = vi.hoisted(() => vi.fn(async () => undefined));
const getGlobalClient = vi.hoisted(() => vi.fn());

vi.mock("../../services/client-instance.js", () => ({
  getGlobalClient,
  initializeClient
}));

vi.mock("toolcraft-design", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  withSpinner: vi.fn(async ({ fn }: { fn: () => Promise<unknown> }) => await fn())
}));

const { parseParams, registerGenerateCommand } = await import("./generate.js");

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync("/repo", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("parseParams", () => {
  it("preserves prototype-named parameters as request values", () => {
    const params = parseParams(["__proto__=visible"]);

    expect(Object.hasOwn(params, "__proto__")).toBe(true);
    expect(params["__proto__"]).toBe("visible");
  });

  it("rejects empty parameter keys", () => {
    expect(() => parseParams(["=foo"])).toThrow('Invalid param key: "=foo". Expected key=value');
  });

  it("trims parameter keys", () => {
    expect(parseParams([" temperature =0.7"])).toEqual({ temperature: "0.7" });
  });
});

describe("generate command authentication", () => {
  beforeEach(() => {
    initializeClient.mockClear();
    getGlobalClient.mockReset()
      .mockImplementationOnce(() => { throw new Error("not initialized"); })
      .mockReturnValue(client);
    vi.mocked(client.text).mockClear();
  });

  it("uses POE_API_KEY when no stored credential exists", async () => {
    const program = new Command();
    program.name("poe-code").option("--dry-run").option("--yes");
    const container = {
      env: {
        cwd: "/repo",
        configPath: "/repo/.poe-code/config.json",
        poeApiBaseUrl: "https://api.poe.com/v1",
        variables: { POE_API_KEY: "environment-key" },
        getVariable: vi.fn((name: string) => name === "POE_API_KEY" ? "environment-key" : undefined)
      },
      fs: createMemFs(),
      loggerFactory: {
        create: vi.fn(() => ({ dryRun: vi.fn() }))
      },
      commandRunner: vi.fn(),
      contextFactory: {
        create: vi.fn(() => ({}))
      },
      readApiKey: vi.fn(async () => null)
    } as unknown as CliContainer;
    registerGenerateCommand(program, container);

    await program.parseAsync(["node", "cli", "generate", "text", "--model", "test/model", "Hello"]);

    expect(initializeClient).toHaveBeenCalledWith({
      apiKey: "environment-key",
      baseUrl: "https://api.poe.com/v1",
      httpClient: undefined
    });
    expect(client.text).toHaveBeenCalledWith({
      model: "test/model",
      prompt: "Hello",
      params: {}
    });
  });

  it("validates credentials during dry-run", async () => {
    const program = new Command();
    program.name("poe-code").option("--dry-run").option("--yes");
    const container = {
      env: {
        cwd: "/repo",
        configPath: "/repo/.poe-code/config.json",
        poeApiBaseUrl: "https://api.poe.com/v1",
        variables: {},
        getVariable: vi.fn(() => undefined)
      },
      fs: createMemFs(),
      loggerFactory: {
        create: vi.fn(() => ({ dryRun: vi.fn() }))
      },
      commandRunner: vi.fn(),
      contextFactory: {
        create: vi.fn(() => ({}))
      },
      readApiKey: vi.fn(async () => null)
    } as unknown as CliContainer;
    registerGenerateCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "generate", "text", "Hello"])
    ).rejects.toThrow("Poe API key not found. Run 'poe-code login' first.");
  });

  it("rejects whitespace-only model options", async () => {
    const dryRun = vi.fn();
    const program = new Command();
    program.name("poe-code").option("--dry-run").option("--yes");
    const container = {
      env: {
        cwd: "/repo",
        configPath: "/repo/.poe-code/config.json",
        poeApiBaseUrl: "https://api.poe.com/v1",
        variables: { POE_API_KEY: "environment-key" },
        getVariable: vi.fn((name: string) => name === "POE_API_KEY" ? "environment-key" : undefined)
      },
      fs: createMemFs(),
      loggerFactory: {
        create: vi.fn(() => ({ dryRun }))
      },
      commandRunner: vi.fn(),
      contextFactory: {
        create: vi.fn(() => ({}))
      },
      readApiKey: vi.fn(async () => null)
    } as unknown as CliContainer;
    registerGenerateCommand(program, container);

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "generate", "text", "--model", "   ", "Hello"])
    ).rejects.toThrow("--model must be a non-empty string.");
    expect(dryRun).not.toHaveBeenCalled();
  });
});
