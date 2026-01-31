import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import { setGlobalClient } from "../../services/client-instance.js";
import type { FileSystem } from "../utils/file-system.js";
import type { LlmClient, LlmRequest } from "../services/llm-client.js";
import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "../constants.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  volume.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createGenerateProgram(options?: {
  fs?: FileSystem;
  variables?: Record<string, string | undefined>;
}) {
  const fs = options?.fs ?? createMemfs();
  const program = createProgram({
    fs,
    prompts: vi.fn(),
    env: { cwd, homeDir, variables: options?.variables ?? {} },
    logger: () => {},
    suppressCommanderOutput: true
  });
  return { program, fs };
}

describe("generate command", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("generates text with default command", async () => {
    const { program } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async (request: LlmRequest) => ({
        content: `model:${request.model} prompt:${request.prompt}`
      })),
      media: vi.fn(async () => ({}))
    };
    setGlobalClient(client);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "What is 2+2?"
    ]);

    expect(client.text).toHaveBeenCalledWith({
      model: DEFAULT_TEXT_MODEL,
      prompt: "What is 2+2?",
      params: {}
    });

    // Verify the response content appears in the output (as subtext)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain(`model:${DEFAULT_TEXT_MODEL} prompt:What is 2+2?`);
  });

  it("uses explicit text subcommand with params", async () => {
    const { program } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({}))
    };
    setGlobalClient(client);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "text",
      "--model",
      "Custom-Text-Model",
      "--param",
      "thinking_budget=28672",
      "--param",
      "web_search=true",
      "Explain AI"
    ]);

    expect(client.text).toHaveBeenCalledWith({
      model: "Custom-Text-Model",
      prompt: "Explain AI",
      params: {
        thinking_budget: "28672",
        web_search: "true"
      }
    });
  });

  it("respects POE_TEXT_MODEL override", async () => {
    const { program } = createGenerateProgram({
      variables: { POE_TEXT_MODEL: "Env-Model" }
    });
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({}))
    };
    setGlobalClient(client);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "Hello"
    ]);

    expect(client.text).toHaveBeenCalledWith({
      model: "Env-Model",
      prompt: "Hello",
      params: {}
    });
  });

  it("downloads image output to cwd when no output path is provided", async () => {
    const { program, fs } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({
        url: "https://example.com/image.png",
        mimeType: "image/png"
      }))
    };
    setGlobalClient(client);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1737984000);

    const fetchMock = vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    } as unknown as Response);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "image",
      "A sunset"
    ]);

    const saved = await fs.readFile("/repo/image-1737984000.png");
    expect(saved).toEqual(Buffer.from([1, 2, 3]));

    // Verify the saved path appears in stdout (via outro)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("./image-1737984000.png");

    nowSpy.mockRestore();
  });

  it("uses provided output path for image generation", async () => {
    const { program, fs } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({
        url: "https://example.com/image.png",
        mimeType: "image/png"
      }))
    };
    setGlobalClient(client);

    const fetchMock = vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer
    } as unknown as Response);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "image",
      "-o",
      "custom.png",
      "A cat"
    ]);

    const saved = await fs.readFile("/repo/custom.png");
    expect(saved).toEqual(Buffer.from([9, 8, 7]));

    // Verify the saved path appears in stdout (via outro)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("./custom.png");
  });

  it("downloads video output to cwd when no output path is provided", async () => {
    const { program, fs } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({
        url: "https://example.com/video.mp4",
        mimeType: "video/mp4"
      }))
    };
    setGlobalClient(client);

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1737984000);

    const fetchMock = vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer
    } as unknown as Response);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "video",
      "A rocket launch"
    ]);

    const saved = await fs.readFile("/repo/video-1737984000.mp4");
    expect(saved).toEqual(Buffer.from([4, 5, 6]));
    expect(client.media).toHaveBeenCalledWith("video", {
      model: DEFAULT_VIDEO_BOT,
      prompt: "A rocket launch",
      params: {}
    });

    // Verify the saved path appears in stdout (via outro)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("./video-1737984000.mp4");

    nowSpy.mockRestore();
  });

  it("uses provided output path for audio generation", async () => {
    const { program, fs } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({
        url: "https://example.com/audio.mp3",
        mimeType: "audio/mp3"
      }))
    };
    setGlobalClient(client);

    const fetchMock = vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer
    } as unknown as Response);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "audio",
      "-o",
      "clip.mp3",
      "Hello world"
    ]);

    const saved = await fs.readFile("/repo/clip.mp3");
    expect(saved).toEqual(Buffer.from([7, 8, 9]));
    expect(client.media).toHaveBeenCalledWith("audio", {
      model: DEFAULT_AUDIO_BOT,
      prompt: "Hello world",
      params: {}
    });

    // Verify the saved path appears in stdout (via outro)
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(output).toContain("./clip.mp3");
  });

  it("uses the default image model when none is provided", async () => {
    const { program } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({
        url: "https://example.com/image.png",
        mimeType: "image/png"
      }))
    };
    setGlobalClient(client);

    const fetchMock = vi.mocked(global.fetch as unknown as ReturnType<typeof vi.fn>);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer
    } as unknown as Response);

    await program.parseAsync([
      "node",
      "cli",
      "generate",
      "image",
      "A bird"
    ]);

    expect(client.media).toHaveBeenCalledWith("image", {
      model: DEFAULT_IMAGE_BOT,
      prompt: "A bird",
      params: {}
    });
  });

  it("rejects invalid --param values", async () => {
    const { program } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({}))
    };
    setGlobalClient(client);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "generate",
        "--param",
        "missing-equals",
        "Hello"
      ])
    ).rejects.toThrow("Invalid param format");
  });

  it("includes raw response content when media URL is missing", async () => {
    const { program } = createGenerateProgram();
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({ content: "RAW-RESPONSE" }))
    };
    setGlobalClient(client);

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "generate",
        "image",
        "A cat"
      ])
    ).rejects.toThrow("RAW-RESPONSE");
  });
});
