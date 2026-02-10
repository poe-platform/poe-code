import { describe, it, expect, beforeEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import type { FileSystem } from "../utils/file-system.js";
import type { HttpClient } from "../http.js";

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

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    getTheme: getThemeMock
  };
});

const cwd = "/repo";
const homeDir = "/home/test";
const credentialsPath = `${homeDir}/.poe-code/credentials.json`;

function createMemfs(dir: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(dir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createCredentialsVolume(apiKey: string): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(`${homeDir}/.poe-code`, { recursive: true });
  volume.writeFileSync(
    credentialsPath,
    JSON.stringify({ apiKey })
  );
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createModelEntry(overrides: Partial<{
  id: string;
  created: number;
  owned_by: string;
  context_length: number;
  max_output_tokens: number;
  supported_features: string[];
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
    pricing: overrides.pricing ?? null,
    architecture: overrides.architecture ?? null,
    reasoning: overrides.reasoning ?? null
  };
}

async function runModels(options: {
  fs: FileSystem;
  httpClient: HttpClient;
  logs: string[];
  args?: string[];
}) {
  const program = createProgram({
    fs: options.fs,
    prompts: vi.fn(),
    env: { cwd, homeDir },
    httpClient: options.httpClient,
    logger: (message) => options.logs.push(message)
  });
  vi.spyOn(program, "optsWithGlobals").mockReturnValue({ yes: false, dryRun: false } as any);
  await program.parseAsync(["node", "cli", "models", ...(options.args ?? [])]);
  return options.logs.join("\n");
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
    fs = createCredentialsVolume("test-key");
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

  it("sorts models by created date descending (newest first)", async () => {
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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

    expect(output).toContain("anthropic/claude-sonnet");
    expect(output).not.toContain("openai/gpt-5");
  });

  it("filters by --model (case-insensitive)", async () => {
    fs = createCredentialsVolume("test-key");
    const models = [
      createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" }),
      createModelEntry({ id: "gpt-5", owned_by: "OpenAI" })
    ];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs, args: ["--model", "GPT"] });

    expect(output).not.toContain("anthropic/claude-sonnet");
    expect(output).toContain("openai/gpt-5");
  });

  it("filters by --feature for supported_features", async () => {
    fs = createCredentialsVolume("test-key");
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

  it("filters by --feature reasoning (treats reasoning as a feature)", async () => {
    fs = createCredentialsVolume("test-key");
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

  it("filters by --input modalities", async () => {
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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

  it("filters by --output modalities", async () => {
    fs = createCredentialsVolume("test-key");
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

  it("pricing view shows separate columns for each price type", async () => {
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: [] })
    });

    await runModels({ fs, httpClient, logs });

    expect(logs.some((m) => m.includes("No models found."))).toBe(true);
  });

  it("shows no-match message when filters exclude everything", async () => {
    fs = createCredentialsVolume("test-key");
    const models = [createModelEntry({ id: "claude-sonnet", owned_by: "Anthropic" })];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    await runModels({ fs, httpClient, logs, args: ["--provider", "xyz"] });

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
    fs = createCredentialsVolume("my-key");
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

  it("logs dry run message when --dry-run flag is set", async () => {
    fs = createCredentialsVolume("test-key");
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

  it("throws ApiError on non-ok response", async () => {
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
    const models = [createModelEntry({ id: "test", owned_by: "A", created: 1705276800000 })];
    (httpClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: "list", data: models })
    });

    const output = await runModels({ fs, httpClient, logs });

    expect(output).toContain("2024-01-15");
  });

  it("avoids floating point errors in pricing conversion", async () => {
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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
    fs = createCredentialsVolume("test-key");
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

  it("--view pricing shows pricing columns without features", async () => {
    fs = createCredentialsVolume("test-key");
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
});
