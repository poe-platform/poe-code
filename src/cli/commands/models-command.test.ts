import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parse as yamlParse } from "yaml";
import { withOutputFormat } from "toolcraft-design";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";
import { ValidationError } from "../errors.js";
import { storeTestApiKey } from "../../../tests/test-helpers.js";

const getThemeMock = vi.hoisted(() => vi.fn());

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

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    getTheme: getThemeMock
  };
});

const cwd = "/repo";
const homeDir = "/home/test";

function createMemfs(dir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(dir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function createConfigVolume(apiKey: string): Promise<FileSystem> {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
  await storeTestApiKey(fs, homeDir, apiKey);
  return fs;
}

interface TestParameter {
  name: string;
  schema: { type?: string; enum?: string[]; minimum?: number; maximum?: number };
  default_value?: unknown;
  description?: string;
}

function createModelEntry(overrides: Partial<{
  id: string;
  created: number;
  owned_by: string;
  context_length: number;
  max_output_tokens: number;
  supported_features: string[];
  supported_endpoints: string[] | null;
  pricing: {
    prompt: number | null;
    completion: number | null;
    request: number | null;
    input_cache_read: number | null;
    input_cache_write: number | null;
  } | null;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
  } | null;
  reasoning: object | null;
  parameters: TestParameter[];
}> = {}) {
  return {
    id: overrides.id ?? "test-model",
    object: "model",
    created: overrides.created ?? 1700000000000,
    owned_by: overrides.owned_by ?? "TestProvider",
    context_window: {
      context_length: overrides.context_length ?? 128000,
      max_output_tokens: overrides.max_output_tokens ?? 4096
    },
    supported_features: overrides.supported_features ?? [],
    supported_endpoints: overrides.supported_endpoints ?? null,
    pricing: overrides.pricing ?? null,
    architecture: overrides.architecture ?? null,
    reasoning: overrides.reasoning ?? null,
    parameters: overrides.parameters ?? []
  };
}

async function runModels(options: {
  fs: FileSystem;
  httpClient: HttpClient;
  logs: string[];
  args?: string[];
  variables?: Record<string, string | undefined>;
}) {
  const program = createProgram({
    fs: options.fs,
    prompts: vi.fn(),
    env: { cwd, homeDir, variables: options.variables ?? {} },
    httpClient: options.httpClient,
    logger: (message) => options.logs.push(message)
  });
  vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    await program.parseAsync(["node", "cli", "models", ...(options.args ?? [])]);
    return options.logs.join("\n");
  } finally {
    stdout.mockRestore();
  }
}

async function runModelsWithStdout(options: {
  fs: FileSystem;
  httpClient: HttpClient;
  args?: string[];
  variables?: Record<string, string | undefined>;
}): Promise<string> {
  const chunks: string[] = [];
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);

  try {
    const program = createProgram({
      fs: options.fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: options.variables ?? {} },
      httpClient: options.httpClient,
      suppressCommanderOutput: true
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);
    await program.parseAsync(["node", "cli", "models", ...(options.args ?? [])]);
    return chunks.join("");
  } finally {
    stdoutSpy.mockRestore();
  }
}

describe("models command", () => {
  let fs: FileSystem;
  let logs: string[];
  let httpClient: HttpClient;

  beforeEach(() => {
    fs = createMemfs(homeDir);
    logs = [];
    httpClient = vi.fn();
    getThemeMock.mockReset().mockReturnValue(createIdentityTheme());
  });

  it("fetches models from /v1/models and displays table", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic", created: 1700000000000 }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI", created: 1690000000000 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/v1/models"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key"
        })
      })
    );
    expect(output).toContain("anthropic/claude-sonnet");
    expect(output).toContain("openai/gpt-5");
  });

  it("renders prototype-named feature columns as supported", async () => {
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [createModelEntry({ supported_features: ["__proto__"] })]
      })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("__proto__");
    expect(output).toContain("✓");
    expect(output).not.toContain("[object Object]");
  });

  it("sorts models by created date descending (newest first)", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "old-model", owned_by: "A", created: 1600000000000 }),
      createModelEntry({ id: "new-model", owned_by: "B", created: 1800000000000 }),
      createModelEntry({ id: "mid-model", owned_by: "C", created: 1700000000000 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    const newIdx = output.indexOf("b/new-model");
    const midIdx = output.indexOf("c/mid-model");
    const oldIdx = output.indexOf("a/old-model");
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  it("filters by --provider (case-insensitive)", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--provider", "anthropic"] });

    expect(output).toContain("1/2 models");
    expect(output).toContain("anthropic/claude-sonnet");
    expect(output).not.toContain("openai/gpt-5");
  });

  it("rejects empty --provider, --model, --search, and --endpoint values before fetching", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" })]
      })
    });

    for (const flag of ["--provider", "--model", "--search", "--endpoint"]) {
      await expect(
        runModels({ fs, httpClient, logs, args: [flag, ""] })
      ).rejects.toThrow(`Invalid ${flag} value: must be non-empty.`);
    }

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("rejects empty --model in raw view instead of dumping the whole catalog", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [createModelEntry({ id: "claude-opus-4.7", owned_by: "Anthropic" })]
      })
    });

    await expect(
      runModelsWithStdout({ fs, httpClient, args: ["--view", "raw", "--model", ""] })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("rejects unknown --provider against catalog-derived providers with suggestions", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--provider", "not-a-provider"] })
    ).rejects.toThrow(
      'Unknown --provider value "not-a-provider". Known --provider values: anthropic, openai'
    );

    logs = [];
    await expect(
      runModels({ fs, httpClient, logs, args: ["--provider", "anthropik"] })
    ).rejects.toThrow('Did you mean: anthropic?');
  });

  it("rejects unknown --feature against catalog-derived features with suggestions", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "with-tools", owned_by: "A", supported_features: ["tools"] }),
      createModelEntry({ id: "searcher", owned_by: "B", supported_features: ["web_search"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--feature", "bogus"] })
    ).rejects.toThrow(
      'Unknown --feature value "bogus". Known --feature values: reasoning, tools, web_search'
    );

    logs = [];
    await expect(
      runModels({ fs, httpClient, logs, args: ["--feature", "tool"] })
    ).rejects.toThrow('Did you mean: tools?');
  });

  it("rejects unknown --output modality such as json", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "gen-image",
        owned_by: "A",
        architecture: { input_modalities: ["text"], output_modalities: ["image", "text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--output", "json"] })
    ).rejects.toThrow(
      'Unknown --output value "json". Known --output values: image, text'
    );
  });

  it("rejects unknown --input modality", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "multimodal",
        owned_by: "A",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--input", "text,bogus"] })
    ).rejects.toThrow(
      'Unknown --input value "bogus". Known --input values: image, text'
    );
  });

  it("filters by --model exact match (case-insensitive)", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" }),
      createModelEntry({ id: "gpt-5-mini", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--model", "GpT-5"] });

    expect(output).toContain("openai/gpt-5");
    expect(output).not.toContain("openai/gpt-5-mini");
  });

  it("filters by --search using substring match on model id and provider", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const byProvider = await runModels({ fs, httpClient, logs, args: ["--search", "throp"] });
    expect(byProvider).toContain("anthropic/claude-sonnet");
    expect(byProvider).not.toContain("openai/gpt-5");

    logs = [];
    const byModel = await runModels({ fs, httpClient, logs, args: ["--search", "gpt"] });
    expect(byModel).toContain("openai/gpt-5");
    expect(byModel).not.toContain("anthropic/claude-sonnet");
  });

  it("filters by --model using the namespaced owned_by/id form the table renders", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-opus-4.7", owned_by: "Anthropic" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--model", "Anthropic/claude-opus-4.7"]
    });

    expect(output).toContain("1/2 models");
    expect(output).toContain("anthropic/claude-opus-4.7");
    expect(output).not.toContain("openai/gpt-5");
  });

  it("filters --view raw by the namespaced model id instead of emitting an empty array", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [
          createModelEntry({ id: "claude-haiku-4.5", owned_by: "Anthropic" }),
          createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
        ]
      })
    });

    const output = await runModelsWithStdout({
      fs,
      httpClient,
      args: ["--view", "raw", "--model", "anthropic/claude-haiku-4.5"]
    });

    expect(yamlParse(output)).toEqual([
      expect.objectContaining({ id: "claude-haiku-4.5", owned_by: "Anthropic" })
    ]);
  });

  it("filters by --search using the rendered provider/id label, including spaced provider names", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "kimi-k2.5", owned_by: "Novita AI" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--search", "novita ai/kimi-k2.5"]
    });

    expect(output).toContain("novita ai/kimi-k2.5");
    expect(output).not.toContain("openai/gpt-5");
  });

  it("filters by --search when the term carries a trailing namespace slash", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--search", "claude/"] });

    expect(output).toContain("anthropic/claude-sonnet");
    expect(output).not.toContain("openai/gpt-5");
  });

  it("rejects a --search term that is only a slash", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [createModelEntry({ id: "gpt-5" })] })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--search", "/"] })
    ).rejects.toThrow(ValidationError);
  });

  it("filters by --tools (shorthand for --feature tools)", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "with-tools", owned_by: "A", supported_features: ["tools"] }),
      createModelEntry({ id: "no-tools", owned_by: "B", supported_features: ["web_search"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--tools"] });

    expect(output).toContain("a/with-tools");
    expect(output).not.toContain("b/no-tools");
  });

  it("filters by --feature for supported_features", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "with-tools", owned_by: "A", supported_features: ["tools"] }),
      createModelEntry({ id: "no-tools", owned_by: "B", supported_features: ["web_search"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--feature", "tools"] });

    expect(output).toContain("a/with-tools");
    expect(output).not.toContain("b/no-tools");
  });

  it("trims --feature before filtering", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "with-tools", owned_by: "A", supported_features: ["tools"] }),
      createModelEntry({ id: "no-tools", owned_by: "B", supported_features: ["web_search"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--feature", " tools "] });

    expect(output).toContain("a/with-tools");
    expect(output).not.toContain("b/no-tools");
  });

  it("filters by --feature reasoning (treats reasoning as a feature)", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "thinker",
        owned_by: "A",
        reasoning: { budget: null, required: false, supports_reasoning_effort: true }
      }),
      createModelEntry({ id: "non-thinker", owned_by: "B", reasoning: null })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--feature", "reasoning"] });

    expect(output).toContain("a/thinker");
    expect(output).not.toContain("b/non-thinker");
  });

  it("ANDs repeated --feature flags instead of letting the last value win", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "both", owned_by: "A", supported_features: ["tools", "web_search"] }),
      createModelEntry({ id: "tools-only", owned_by: "B", supported_features: ["tools"] }),
      createModelEntry({ id: "search-only", owned_by: "C", supported_features: ["web_search"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--feature", "tools", "--feature", "web_search"]
    });

    expect(output).toContain("a/both");
    expect(output).not.toContain("b/tools-only");
    expect(output).not.toContain("c/search-only");
  });

  it("validates every repeated --feature value, not just the last one", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "with-tools", owned_by: "A", supported_features: ["tools"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--feature", "bogus", "--feature", "tools"] })
    ).rejects.toThrow('Unknown --feature value "bogus"');
  });

  it("ANDs repeated --feature with --tools shorthand", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "both", owned_by: "A", supported_features: ["tools", "web_search"] }),
      createModelEntry({ id: "search-only", owned_by: "B", supported_features: ["web_search"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--tools", "--feature", "web_search"]
    });

    expect(output).toContain("a/both");
    expect(output).not.toContain("b/search-only");
  });

  it("documents that --feature repeats and that filters combine with AND", async () => {
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir, variables: {} },
      httpClient
    });
    const modelsCommand = program.commands.find((command) => command.name() === "models");
    const chunks: string[] = [];
    modelsCommand?.configureOutput({
      writeOut: (text: string) => {
        chunks.push(text);
      }
    });

    modelsCommand?.outputHelp();
    const help = chunks.join("").replace(/\u001b\[[0-9;]*m/g, "");

    expect(help).toMatch(/repeatable/i);
    expect(help).toMatch(/combine with AND/i);
    expect(help).toContain("--feature tools --feature web_search");
  });

  it("filters by --endpoint using supported_endpoints", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "responses-model",
        owned_by: "A",
        supported_endpoints: ["/v1/responses", "/v1/chat/completions"]
      }),
      createModelEntry({
        id: "legacy-model",
        owned_by: "B",
        supported_endpoints: ["/v1/chat/completions"]
      }),
      createModelEntry({
        id: "no-endpoints",
        owned_by: "C",
        supported_endpoints: null
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--endpoint", "/v1/responses"]
    });

    expect(output).toContain("a/responses-model");
    expect(output).not.toContain("b/legacy-model");
    expect(output).not.toContain("c/no-endpoints");
  });

  it("filters by --endpoint for chat completions models", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "dual-endpoint",
        owned_by: "A",
        supported_endpoints: ["/v1/responses", "/v1/chat/completions"]
      }),
      createModelEntry({
        id: "responses-only",
        owned_by: "B",
        supported_endpoints: ["/v1/responses"]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--endpoint", "/v1/chat/completions"]
    });

    expect(output).toContain("a/dual-endpoint");
    expect(output).not.toContain("b/responses-only");
  });

  it("normalizes --endpoint before validation and filtering", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "responses-model",
        owned_by: "A",
        supported_endpoints: ["/v1/responses"]
      }),
      createModelEntry({
        id: "chat-model",
        owned_by: "B",
        supported_endpoints: ["/v1/chat/completions"]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--endpoint", "V1/RESPONSES"]
    });

    expect(output).toContain("a/responses-model");
    expect(output).not.toContain("b/chat-model");
  });

  it("validates --endpoint against preprocessed available endpoints", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "dual-endpoint-a",
        owned_by: "A",
        supported_endpoints: ["/v1/responses", "/v1/chat/completions"]
      }),
      createModelEntry({
        id: "dual-endpoint-b",
        owned_by: "B",
        supported_endpoints: ["/v1/chat/completions", "/v1/responses"]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await expect(
      runModels({
        fs,
        httpClient,
        logs,
        args: ["--endpoint", "/v1/embeddings"]
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      runModels({
        fs,
        httpClient,
        logs,
        args: ["--endpoint", "/v1/embeddings"]
      })
    ).rejects.toThrow(
      'Unsupported endpoint "/v1/embeddings". Available endpoints: /v1/chat/completions, /v1/responses'
    );
  });

  it("filters by --input modalities", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "multimodal",
        owned_by: "A",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }
      }),
      createModelEntry({
        id: "text-only",
        owned_by: "B",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--input", "image"] });

    expect(output).toContain("a/multimodal");
    expect(output).not.toContain("b/text-only");
  });

  it("filters by --input with multiple modalities", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "full",
        owned_by: "A",
        architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["text"] }
      }),
      createModelEntry({
        id: "partial",
        owned_by: "B",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--input", "image,video"] });

    expect(output).toContain("a/full");
    expect(output).not.toContain("b/partial");
  });

  it("trims comma-separated --input modalities", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "full",
        owned_by: "A",
        architecture: { input_modalities: ["text", "image", "video"], output_modalities: ["text"] }
      }),
      createModelEntry({
        id: "partial",
        owned_by: "B",
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--input", "image, video"] });

    expect(output).toContain("a/full");
    expect(output).not.toContain("b/partial");
  });

  it("rejects empty --input modality entries", async () => {
    await expect(
      runModels({ fs, httpClient, logs, args: ["--input", "text,,image"] })
    ).rejects.toThrow("Invalid --input value: modalities must be non-empty comma-separated values.");

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("filters by --output modalities", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "gen-image",
        owned_by: "A",
        architecture: { input_modalities: ["text"], output_modalities: ["image"] }
      }),
      createModelEntry({
        id: "gen-text",
        owned_by: "B",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--output", "image"] });

    expect(output).toContain("a/gen-image");
    expect(output).not.toContain("b/gen-text");
  });

  it("trims comma-separated --output modalities", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "gen-image",
        owned_by: "A",
        architecture: { input_modalities: ["text"], output_modalities: ["text", "image"] }
      }),
      createModelEntry({
        id: "gen-text",
        owned_by: "B",
        architecture: { input_modalities: ["text"], output_modalities: ["text"] }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--output", "text, image"] });

    expect(output).toContain("a/gen-image");
    expect(output).not.toContain("b/gen-text");
  });

  it("rejects empty --output modality entries", async () => {
    await expect(
      runModels({ fs, httpClient, logs, args: ["--output", "text,"] })
    ).rejects.toThrow("Invalid --output value: modalities must be non-empty comma-separated values.");

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("pricing view shows separate columns for each price type", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "claude-sonnet",
        owned_by: "Anthropic",
        pricing: {
          prompt: 0.0000026,
          completion: 0.000013,
          request: null,
          input_cache_read: 0.00000026,
          input_cache_write: 0.0000032
        }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "pricing"] });

    expect(output).toContain("Input");
    expect(output).toContain("Output");
    expect(output).toContain("Cache Read");
    expect(output).toContain("Cache Write");
    expect(output).toContain("Request");
    expect(output).toContain("$2.60");
    expect(output).toContain("$13.00");
    expect(output).toContain("$0.26");
    expect(output).toContain("$3.20");
  });

  it("pricing view shows request price column", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "request-model",
        owned_by: "A",
        pricing: {
          prompt: null,
          completion: null,
          request: 0.000005,
          input_cache_read: null,
          input_cache_write: null
        }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "pricing"] });

    expect(output).toContain("$5.00");
  });

  it("displays supported features as dynamic columns", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "model-a", owned_by: "A", supported_features: ["web_search", "tools"] }),
      createModelEntry({ id: "model-b", owned_by: "B", supported_features: ["tools"] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("web_search");
    expect(output).toContain("tools");
    expect(output).toContain("✓");
  });

  it("formats context_length as human-readable (e.g. 1M, 128K)", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "big-ctx", owned_by: "A", context_length: 1048576 }),
      createModelEntry({ id: "small-ctx", owned_by: "B", context_length: 4096 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("1M");
    expect(output).toContain("4K");
  });

  it("displays input and output modalities", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "multimodal",
        owned_by: "A",
        architecture: {
          input_modalities: ["text", "image", "video"],
          output_modalities: ["text"]
        }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("text,image,video->text");
  });

  it("shows reasoning checkmark when model supports reasoning", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "thinker",
        owned_by: "A",
        reasoning: { budget: { max_tokens: 31999 }, required: false, supports_reasoning_effort: false }
      }),
      createModelEntry({ id: "non-thinker", owned_by: "B", reasoning: null })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("Reasoning");
    expect(output).toContain("✓");
  });

  it("shows 'No models found.' when API returns empty data", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [] })
    });

    await runModels({ fs, httpClient, logs });

    expect(logs.some((m) => m.includes("No models found."))).toBe(true);
  });

  it("shows no-match message when filters exclude everything", async () => {
    fs = await createConfigVolume("test-key");
    const models = [createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" })];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await runModels({ fs, httpClient, logs, args: ["--model", "claude-opus-9"] });

    expect(logs.some((m) => m.includes("No models match the given filters."))).toBe(true);
  });

  it("works without API key (no Authorization header)", async () => {
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/v1/models"),
      expect.objectContaining({
        method: "GET",
        headers: {}
      })
    );
    expect(output).toContain("anthropic/claude-sonnet");
  });

  it("includes Authorization header when API key is available", async () => {
    fs = await createConfigVolume("my-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await runModels({ fs, httpClient, logs });

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/v1/models"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer my-key" }
      })
    );
  });

  it("includes Authorization header when POE_API_KEY is set", async () => {
    const models = [createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" })];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await runModels({ fs, httpClient, logs, variables: { POE_API_KEY: "environment-key" } });

    expect(httpClient).toHaveBeenCalledWith(
      expect.stringContaining("/v1/models"),
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer environment-key" }
      })
    );
  });

  it("logs dry run message when --dry-run flag is set", async () => {
    fs = await createConfigVolume("test-key");
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: true } as any);

    await program.parseAsync(["node", "cli", "--dry-run", "models"]);

    expect(httpClient).not.toHaveBeenCalled();
    expect(logs.some((m) => m.includes("Dry run"))).toBe(true);
  });

  it("does not migrate legacy credentials while previewing models", async () => {
    fs = createMemfs(homeDir);
    await storeTestApiKey(fs, homeDir, "legacy-key");
    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message),
      exitOverride: true
    });

    await program.parseAsync(["node", "cli", "--dry-run", "models"]);

    await expect(fs.readdir(`${homeDir}/.poe-code`)).resolves.toEqual(["credentials.enc"]);
  });

  it("throws ApiError on non-ok response", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    });

    const program = createProgram({
      fs,
      prompts: vi.fn(),
      env: { cwd, homeDir },
      httpClient,
      logger: (message) => logs.push(message)
    });
    vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);

    await expect(
      program.parseAsync(["node", "cli", "models"])
    ).rejects.toThrow();
  });

  it("displays date in YYYY-MM-DD format", async () => {
    fs = await createConfigVolume("test-key");
    const models = [createModelEntry({ id: "test", owned_by: "A", created: 1705276800000 })];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("2024-01-15");
  });

  it("rejects models with invalid created timestamps", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [
          {
            ...createModelEntry({ id: "bad-date", owned_by: "A" }),
            created: "not-a-timestamp"
          }
        ]
      })
    });

    await expect(runModels({ fs, httpClient, logs })).rejects.toThrow(
      "Invalid models response: data[0].created must be a finite number."
    );
  });

  it("avoids floating point errors in pricing conversion", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "precise",
        owned_by: "A",
        pricing: {
          prompt: 0.00000040,
          completion: 0.0000024,
          request: null,
          input_cache_read: null,
          input_cache_write: null
        }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "pricing"] });

    expect(output).toContain("$0.40");
    expect(output).toContain("$2.40");
  });

  it("defaults to capabilities view without --view flag", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "claude-sonnet",
        owned_by: "Anthropic",
        supported_features: ["tools"],
        pricing: { prompt: 0.000003, completion: 0.000015, request: null },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        reasoning: { budget: null, required: false, supports_reasoning_effort: true }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("Modality");
    expect(output).toContain("Reasoning");
    expect(output).toContain("tools");
    expect(output).not.toContain("$/MTok");
  });

  it("--view capabilities shows capabilities columns", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "test-model",
        owned_by: "A",
        supported_features: ["web_search"],
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        reasoning: { budget: null, required: false, supports_reasoning_effort: false }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "capabilities"] });

    expect(output).toContain("text,image->text");
    expect(output).toContain("Reasoning");
    expect(output).toContain("web_search");
    expect(output).not.toContain("$/MTok");
  });

  it("rejects invalid --view values before fetching models", async () => {
    await expect(
      runModels({ fs, httpClient, logs, args: ["--view", "price"] })
    ).rejects.toThrow(/Allowed choices are .*pricing/);

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("filters by --since duration (excludes old models)", async () => {
    fs = await createConfigVolume("test-key");
    const now = Date.now();
    const models = [
      createModelEntry({ id: "recent", owned_by: "A", created: now - 1000 * 60 * 60 * 24 }),
      createModelEntry({ id: "old", owned_by: "B", created: now - 1000 * 60 * 60 * 24 * 90 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--since", "7d"] });

    expect(output).toContain("a/recent");
    expect(output).not.toContain("b/old");
  });

  it("rejects invalid --since durations before fetching models", async () => {
    await expect(
      runModels({ fs, httpClient, logs, args: ["--since", "last-week"] })
    ).rejects.toThrow(
      'Invalid --since duration "last-week". Use a positive duration such as 7d, 2w, 3mo, or 1y.'
    );

    expect(httpClient).not.toHaveBeenCalled();
  });

  it("reports validation failures once without operation chrome", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [createModelEntry({ id: "gpt-5" })] })
    });

    await expect(
      runModels({ fs, httpClient, logs, args: ["--endpoint", "bogus"] })
    ).rejects.toThrow(ValidationError);

    expect(logs.join("\n")).not.toContain("Error during models");
  });

  it("filters by --since with long-form duration (e.g. '30 days')", async () => {
    fs = await createConfigVolume("test-key");
    const now = Date.now();
    const models = [
      createModelEntry({ id: "recent", owned_by: "A", created: now - 1000 * 60 * 60 * 24 * 10 }),
      createModelEntry({ id: "old", owned_by: "B", created: now - 1000 * 60 * 60 * 24 * 60 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--since", "30 days"] });

    expect(output).toContain("a/recent");
    expect(output).not.toContain("b/old");
  });

  it("explains the time window when --since excludes all models", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "old", owned_by: "A", created: 1600000000000 }),
      createModelEntry({ id: "older", owned_by: "B", created: 1500000000000 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await runModels({ fs, httpClient, logs, args: ["--since", "1d"] });

    expect(logs.some((m) => m.includes("No models added in the last 1d (of 2 total)."))).toBe(true);
    expect(logs.some((m) => m.includes("No models match the given filters."))).toBe(false);
  });

  it("--view pricing shows pricing columns without features", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "claude-sonnet",
        owned_by: "Anthropic",
        supported_features: ["tools", "web_search"],
        pricing: {
          prompt: 0.000003,
          completion: 0.000015,
          request: null,
          input_cache_read: null,
          input_cache_write: null
        },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        reasoning: { budget: null, required: false, supports_reasoning_effort: true }
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "pricing"] });

    expect(output).toContain("$3.00");
    expect(output).toContain("$15.00");
    expect(output).not.toContain("Modality");
    expect(output).not.toContain("Reasoning");
    expect(output).not.toContain("tools");
    expect(output).not.toContain("web_search");
  });

  it("--view parameters shows grouped model headers with parameter rows", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "claude-opus-4.7",
        owned_by: "Anthropic",
        parameters: [
          { name: "web_search", schema: { type: "boolean" }, default_value: false, description: "Enable web search." },
          { name: "output_effort", schema: { enum: ["max", "high", "medium", "low", "none"] }, default_value: "high" }
        ]
      }),
      createModelEntry({
        id: "gemini-3-flash",
        owned_by: "Google",
        parameters: [
          { name: "thinking_level", schema: { enum: ["minimal", "low", "high"] }, default_value: "low" }
        ]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

    expect(output).toContain("anthropic/claude-opus-4.7");
    expect(output).toContain("web_search");
    expect(output).toContain("boolean");
    expect(output).toContain("false");
    expect(output).toContain("output_effort");
    expect(output).toContain("enum");
    expect(output).toContain("max, high, medium, low, none");
    expect(output).toContain("google/gemini-3-flash");
    expect(output).toContain("thinking_level");
  });

  it("--view parameters shows number ranges", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "test-model",
        owned_by: "A",
        parameters: [
          { name: "temperature", schema: { type: "number", minimum: 0, maximum: 2 }, default_value: 0.7 }
        ]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

    expect(output).toContain("temperature");
    expect(output).toContain("number");
    expect(output).toContain("0.7");
    expect(output).toContain("0..2");
  });

  describe("integer parameter ranges", () => {
    describe.each(["integer", "number"])("%s bounds", (type) => {
      it.each([
        { label: "positive minimum", bounds: { minimum: 3 }, expected: "3.." },
        { label: "positive maximum", bounds: { maximum: 9 }, expected: "..9" },
        { label: "zero minimum", bounds: { minimum: 0 }, expected: "0.." },
        { label: "zero maximum", bounds: { maximum: 0 }, expected: "..0" },
        { label: "negative minimum", bounds: { minimum: -5 }, expected: "-5.." },
        { label: "negative maximum", bounds: { maximum: -2 }, expected: "..-2" },
        { label: "positive bounds", bounds: { minimum: 2, maximum: 8 }, expected: "2..8" },
        { label: "mixed-sign bounds", bounds: { minimum: -4, maximum: 6 }, expected: "-4..6" },
        { label: "zero bounds", bounds: { minimum: 0, maximum: 0 }, expected: "0..0" },
        { label: "unbounded", bounds: {}, expected: "" }
      ])("renders the exact Values/Range cell for $label", async ({ bounds, expected }) => {
        fs = await createConfigVolume("test-key");
        const models = [createModelEntry({
          parameters: [{ name: "setting", schema: { type, ...bounds } }]
        })];
        (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ object: "list", data: models })
        });

        const output = await withOutputFormat("terminal", () =>
          runModels({ fs, httpClient, logs, args: ["--view", "parameters"] })
        );
        const parameterRow = output.split("\n")
          .map((line) => line.split("│").map((cell) => cell.trim()))
          .find((cells) => cells[2] === "setting");

        expect(parameterRow).toEqual(["", "", "setting", type, "", expected, ""]);
      });

      it("preserves enum precedence over numeric bounds", async () => {
        fs = await createConfigVolume("test-key");
        const models = [createModelEntry({
          parameters: [{
            name: "setting",
            schema: { type, enum: ["2", "8"], minimum: 2, maximum: 8 }
          }]
        })];
        (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ object: "list", data: models })
        });

        const output = await withOutputFormat("terminal", () =>
          runModels({ fs, httpClient, logs, args: ["--view", "parameters"] })
        );
        const parameterRow = output.split("\n")
          .map((line) => line.split("│").map((cell) => cell.trim()))
          .find((cells) => cells[2] === "setting");

        expect(parameterRow).toEqual(["", "", "setting", "enum", "", "2, 8", ""]);
      });
    });

    it("round-trips numeric constraints through raw YAML unchanged", async () => {
      fs = await createConfigVolume("test-key");
      const parameters: TestParameter[] = [
        { name: "integer_bounds", schema: { type: "integer", minimum: 0, maximum: 10 } },
        { name: "integer_minimum", schema: { type: "integer", minimum: -5 } },
        { name: "integer_maximum", schema: { type: "integer", maximum: 0 } },
        { name: "integer_unbounded", schema: { type: "integer" } },
        { name: "number_control", schema: { type: "number", minimum: 0, maximum: 10 } }
      ];
      (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: [createModelEntry({ parameters })] })
      });

      const output = await runModelsWithStdout({ fs, httpClient, args: ["--view", "raw"] });

      expect(yamlParse(output)).toEqual([expect.objectContaining({ parameters })]);
    });
  });

  it("--view parameters skips models without parameters", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "has-params",
        owned_by: "A",
        parameters: [
          { name: "web_search", schema: { type: "boolean" }, default_value: false }
        ]
      }),
      createModelEntry({
        id: "no-params",
        owned_by: "B",
        parameters: []
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

    expect(output).toContain("a/has-params");
    expect(output).not.toContain("b/no-params");
  });

  it("--view parameters shows no-match message when no models have parameters", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "no-params", owned_by: "A", parameters: [] })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

    expect(logs.some((m) => m.includes("No models with parameters match the given filters."))).toBe(true);
  });

  it("--view raw writes parseable YAML to stdout without status decoration", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "claude-opus-4.7",
        owned_by: "Anthropic",
        context_length: 983040,
        supported_features: ["tools", "web_search"],
        parameters: [
          { name: "output_effort", schema: { enum: ["max", "high"] }, default_value: "high" }
        ]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModelsWithStdout({ fs, httpClient, args: ["--view", "raw"] });

    expect(yamlParse(output)).toEqual([
      expect.objectContaining({
        id: "claude-opus-4.7",
        owned_by: "Anthropic",
        supported_features: ["tools", "web_search"]
      })
    ]);
    expect(output).toContain("output_effort");
    expect(output).not.toContain("models");
    expect(output).not.toContain("fetched");
  });

  it("--view raw serializes empty filtered results as YAML", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        object: "list",
        data: [createModelEntry({ id: "claude-opus-4.7", owned_by: "Anthropic" })]
      })
    });

    const output = await runModelsWithStdout({
      fs,
      httpClient,
      args: ["--view", "raw", "--model", "claude-opus-9"]
    });

    expect(yamlParse(output)).toEqual([]);
    expect(output.trim()).toBe("[]");
    expect(output).not.toContain("0/1 models");
    expect(output).not.toContain("No models match");
  });

  it("--view parameters truncates long enum values with ellipsis", async () => {
    fs = await createConfigVolume("test-key");
    const longEnum = Array.from({ length: 50 }, (_, i) => `voice-${String(i).padStart(3, "0")}`);
    const models = [
      createModelEntry({
        id: "tts-model",
        owned_by: "A",
        parameters: [
          { name: "voice", schema: { enum: longEnum }, default_value: "voice-000" }
        ]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

    expect(output).toContain("…");
    expect(output).not.toContain("voice-049");
  });

  it("caps unfiltered output at the default limit and reports the truncation", async () => {
    fs = await createConfigVolume("test-key");
    const models = Array.from({ length: 55 }, (_, i) =>
      createModelEntry({
        id: `model-${String(i).padStart(2, "0")}`,
        owned_by: "A",
        created: 1_800_000_000_000 - i * 1000
      })
    );
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("a/model-00");
    expect(output).toContain("a/model-49");
    expect(output).not.toContain("a/model-50");
    expect(output).toContain("showing 50 of 55 models");
  });

  it("--limit caps rendered rows to the newest models", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "newest", owned_by: "A", created: 1_800_000_000_000 }),
      createModelEntry({ id: "middle", owned_by: "A", created: 1_700_000_000_000 }),
      createModelEntry({ id: "oldest", owned_by: "A", created: 1_600_000_000_000 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--limit", "2"] });

    expect(output).toContain("a/newest");
    expect(output).toContain("a/middle");
    expect(output).not.toContain("a/oldest");
    expect(output).toContain("showing 2 of 3 models");
  });

  it("omits the truncation footer when every model is rendered", async () => {
    fs = await createConfigVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [createModelEntry({ id: "only", owned_by: "A" })] })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--limit", "5"] });

    expect(output).toContain("a/only");
    expect(output).not.toContain("showing");
  });

  it("rejects non-positive-integer --limit values before fetching", async () => {
    for (const value of ["0", "-1", "abc", "1.5", ""]) {
      await expect(
        runModels({ fs, httpClient, logs, args: ["--limit", value] })
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(httpClient).not.toHaveBeenCalled();
  });

  it("--view parameters applies the limit instead of dumping every model", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "newest",
        owned_by: "A",
        created: 1_800_000_000_000,
        parameters: [{ name: "temperature", schema: { type: "number", minimum: 0, maximum: 2 } }]
      }),
      createModelEntry({
        id: "oldest",
        owned_by: "A",
        created: 1_600_000_000_000,
        parameters: [{ name: "top_p", schema: { type: "number", minimum: 0, maximum: 1 } }]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({
      fs,
      httpClient,
      logs,
      args: ["--view", "parameters", "--limit", "1"]
    });

    expect(output).toContain("a/newest");
    expect(output).toContain("temperature");
    expect(output).not.toContain("a/oldest");
    expect(output).toContain("showing 1 of 2 models");
  });

  describe("parameter eligibility before limits", () => {
    let models: ReturnType<typeof createModelEntry>[];

    beforeEach(async () => {
      fs = await createConfigVolume("test-key");
      models = [
        createModelEntry({
          id: "eligible-oldest",
          owned_by: "A",
          created: 1_600_000_000_000,
          parameters: [{ name: "top_p", schema: { type: "number" } }]
        }),
        createModelEntry({
          id: "parameterless-newest",
          owned_by: "A",
          created: 1_800_000_000_000
        }),
        createModelEntry({
          id: "eligible-newest",
          owned_by: "A",
          created: 1_700_000_000_000,
          parameters: [
            { name: "temperature", schema: { type: "number" } },
            { name: "web_search", schema: { type: "boolean" } }
          ]
        })
      ];
      (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: models })
      });
    });

    it.each(["1", "2", "3"])("limits eligible models with --limit %s", async (limit) => {
      const output = await runModels({
        fs, httpClient, logs, args: ["--view", "parameters", "--limit", limit]
      });

      expect(output).toContain("a/eligible-newest");
      expect(output).toContain("temperature");
      expect(output).toContain("web_search");
      expect(output).not.toContain("a/parameterless-newest");
      expect(output).not.toContain("No models");
      if (limit === "1") {
        expect(output).not.toContain("a/eligible-oldest");
        expect(output).toContain("showing 1 of 2 models (--limit 1)");
      } else {
        expect(output).toContain("a/eligible-oldest");
        expect(output.indexOf("a/eligible-newest")).toBeLessThan(output.indexOf("a/eligible-oldest"));
        expect(output).not.toContain("showing");
      }
    });

    it("finds eligible models beyond 50 newer parameterless models", async () => {
      models.push(...Array.from({ length: 50 }, (_, index) => createModelEntry({
        id: `parameterless-${index}`,
        owned_by: "A",
        created: 1_800_000_000_000 + index * 1000
      })));

      const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

      expect(output).toContain("a/eligible-newest");
      expect(output).toContain("a/eligible-oldest");
      expect(output).not.toContain("a/parameterless");
      expect(output).not.toContain("No models");
      expect(output).not.toContain("showing");
    });

    it("counts only eligible models in the default-limit footer", async () => {
      models = [models[1], ...Array.from({ length: 51 }, (_, index) => createModelEntry({
        id: `eligible-${String(index).padStart(2, "0")}`,
        owned_by: "A",
        created: 1_700_000_000_000 - index * 1000,
        parameters: [{ name: "temperature", schema: { type: "number" } }]
      }))];

      const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

      for (let index = 0; index < 50; index++) {
        expect(output).toContain(`a/eligible-${String(index).padStart(2, "0")}`);
      }
      expect(output).not.toContain("a/eligible-50");
      expect(output).not.toContain("a/parameterless-newest");
      expect(output).toContain("showing 50 of 51 models (--limit 50)");
    });

    it.each(["1", "2"])("preserves the global filter banner with --limit %s", async (limit) => {
      models.push(createModelEntry({
        id: "excluded",
        owned_by: "B",
        created: 1_900_000_000_000,
        parameters: [{ name: "excluded_parameter", schema: { type: "boolean" } }]
      }));

      const output = await runModels({
        fs, httpClient, logs,
        args: ["--view", "parameters", "--provider", "A", "--limit", limit]
      });

      expect(output).toContain("3/4 models");
      expect(output).not.toContain("2/4 models");
      expect(output).toContain("a/eligible-newest");
      expect(output).not.toContain("a/parameterless-newest");
      expect(output).not.toContain("b/excluded");
      if (limit === "1") {
        expect(output).not.toContain("a/eligible-oldest");
        expect(output).toContain("showing 1 of 2 models (--limit 1)");
      } else {
        expect(output).toContain("a/eligible-oldest");
        expect(output).not.toContain("showing");
      }
    });

    it.each(["capabilities", "pricing"])("keeps parameterless models in the %s view", async (view) => {
      const output = await runModels({ fs, httpClient, logs, args: ["--view", view, "--limit", "1"] });

      expect(output).toContain("a/parameterless-newest");
      expect(output).not.toContain("a/eligible-newest");
      expect(output).not.toContain("a/eligible-oldest");
      expect(output).toContain("showing 1 of 3 models (--limit 1)");
    });

    it("keeps parameterless models in raw YAML without a footer", async () => {
      const output = await runModelsWithStdout({
        fs, httpClient, args: ["--view", "raw", "--limit", "1"]
      });

      expect(yamlParse(output)).toEqual([
        expect.objectContaining({ id: "parameterless-newest", parameters: [] })
      ]);
      expect(output).not.toContain("showing");
    });

    it("preserves the generic no-match message for global filters", async () => {
      const output = await runModels({
        fs, httpClient, logs, args: ["--view", "parameters", "--model", "missing"]
      });

      expect(output).toContain("0/3 models");
      expect(output).toContain("No models match the given filters.");
      expect(output).not.toContain("No models with parameters");
      expect(output).not.toContain("showing");
    });

    it("preserves the since-empty message and global model count", async () => {
      models = models.map((model) => ({ ...model, created: Date.now() - 86_400_000 }));

      const output = await runModels({
        fs, httpClient, logs, args: ["--view", "parameters", "--since", "1s"]
      });

      expect(output).toContain("0/3 models");
      expect(output).toContain("No models added in the last 1s (of 3 total).");
      expect(output).not.toContain("No models with parameters");
      expect(output).not.toContain("showing");
    });

    it("preserves the empty API message", async () => {
      models = [];

      const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

      expect(output).toContain("No models found.");
      expect(output).not.toContain("No models with parameters");
      expect(output).not.toContain("showing");
    });

    it("reports parameter emptiness only after the global filter banner", async () => {
      const output = await runModels({
        fs, httpClient, logs,
        args: ["--view", "parameters", "--model", "parameterless-newest", "--limit", "1"]
      });

      expect(output).toContain("1/3 models");
      expect(output).toContain("No models with parameters match the given filters.");
      expect(output.indexOf("1/3 models")).toBeLessThan(output.indexOf("No models with parameters"));
      expect(output).not.toContain("No models match the given filters.");
      expect(output).not.toContain("showing");
    });
  });

  it("--view raw honors --limit without emitting the footer", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({ id: "newest", owned_by: "A", created: 1_800_000_000_000 }),
      createModelEntry({ id: "oldest", owned_by: "A", created: 1_600_000_000_000 })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModelsWithStdout({
      fs,
      httpClient,
      args: ["--view", "raw", "--limit", "1"]
    });

    expect(yamlParse(output)).toEqual([expect.objectContaining({ id: "newest" })]);
    expect(output).not.toContain("showing");
  });

  describe("structured parameter defaults", () => {
    it.each([
      { label: "short object", type: "object", value: { mode: "x" }, expected: '{"mode":"x"}' },
      { label: "empty object", type: "object", value: {}, expected: "{}" },
      { label: "nested object", type: "object", value: { a: [1] }, expected: '{"a":[1]}' },
      { label: "array", type: "array", value: ["a", "b"], expected: '["a","b"]' },
      { label: "empty array", type: "array", value: [], expected: "[]" },
      { label: "zero", type: "number", value: 0, expected: "0" },
      { label: "false", type: "boolean", value: false, expected: "false" },
      { label: "true", type: "boolean", value: true, expected: "true" },
      { label: "string", type: "string", value: "text", expected: "text" },
      { label: "null", type: "string", value: null, expected: "" },
      { label: "undefined", type: "string", value: undefined, expected: "" },
      { label: "empty string", type: "string", value: "", expected: "" }
    ])("renders the exact default cell for $label", async ({ type, value, expected }) => {
      fs = await createConfigVolume("test-key");
      const models = [createModelEntry({
        parameters: [{ name: "setting", schema: { type }, default_value: value }]
      })];
      (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: models })
      });

      const output = await withOutputFormat("terminal", () =>
        runModels({ fs, httpClient, logs, args: ["--view", "parameters"] })
      );
      const parameterRow = output.split("\n")
        .map((line) => line.split("│").map((cell) => cell.trim()))
        .find((cells) => cells[2] === "setting");

      expect(parameterRow).toEqual(["", "", "setting", type, expected, "", ""]);
    });

    it("truncates a long object default to exactly 36 characters", async () => {
      fs = await createConfigVolume("test-key");
      const models = [createModelEntry({
        parameters: [{
          name: "setting",
          schema: { type: "object" },
          default_value: { mode: "abcdefghijklmnopqrstuvwxyz0123456789" }
        }]
      })];
      (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: models })
      });

      const output = await withOutputFormat("markdown", () =>
        runModels({ fs, httpClient, logs, args: ["--view", "parameters"] })
      );

      expect(output.split("\n")).toContain(
        '|  | setting | object | {"mode":"abcdefghijklmnopqrstuvwx... |  |'
      );
    });

    it("round-trips structured defaults through raw YAML without formatting or truncation", async () => {
      fs = await createConfigVolume("test-key");
      const defaults = [
        { mode: "x" }, {}, { a: [1] }, ["a", "b"], [],
        { mode: "abcdefghijklmnopqrstuvwxyz0123456789" }
      ];
      const parameters = defaults.map((value, index) => ({
        name: `setting-${index}`,
        schema: { type: Array.isArray(value) ? "array" : "object" },
        default_value: value
      }));
      (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ object: "list", data: [createModelEntry({ parameters })] })
      });

      const output = await runModelsWithStdout({ fs, httpClient, args: ["--view", "raw"] });

      expect(yamlParse(output)).toEqual([expect.objectContaining({ parameters })]);
    });
  });

  it("--view parameters truncates long default values", async () => {
    fs = await createConfigVolume("test-key");
    const models = [
      createModelEntry({
        id: "test-model",
        owned_by: "A",
        parameters: [
          { name: "prompt", schema: { type: "string" }, default_value: "a]".repeat(30) }
        ]
      })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--view", "parameters"] });

    expect(output).toContain("…");
    expect(output).not.toContain("a]".repeat(30));
  });
});
