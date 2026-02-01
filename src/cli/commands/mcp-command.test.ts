import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../program.js";
import { setGlobalClient } from "../../services/client-instance.js";
import type { FileSystem } from "../utils/file-system.js";
import type { LlmClient } from "../services/llm-client.js";
import {
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "../constants.js";
import { getAgentProfile } from "../mcp-agents.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemfs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync(homeDir, { recursive: true });
  volume.mkdirSync(cwd, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createMcpProgram(options?: {
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

describe("mcp command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("poe-code mcp serve --help", () => {
    it("includes JSON config, tools documentation, and agent list", async () => {
      const { program } = createMcpProgram();
      let helpOutput = "";
      program.configureOutput({
        writeOut: (str: string) => { helpOutput += str; },
        writeErr: (str: string) => { helpOutput += str; }
      });

      try {
        await program.parseAsync(["node", "cli", "mcp", "serve", "--help"]);
      } catch {
        // Commander exits on --help
      }

      expect(helpOutput).toContain("poe-code");
      expect(helpOutput).toContain("mcp");
      expect(helpOutput).toContain("Available Agents");
      expect(helpOutput).toContain("Available Tools");
      expect(helpOutput).toContain("generate_text");
      expect(helpOutput).toContain("generate_image");
      expect(helpOutput).toContain("generate_video");
      expect(helpOutput).toContain("generate_audio");
    });
  });

  it("rejects invalid agent names", async () => {
    const { program } = createMcpProgram();
    await expect(
      program.parseAsync(["node", "cli", "mcp", "serve", "--agent", "unknown"])
    ).rejects.toThrow("Unknown agent");
  });
});

describe("mcp server tools", () => {
  let mockClient: LlmClient;

  beforeEach(() => {
    mockClient = {
      text: vi.fn(async () => ({ content: "Hello from bot" })),
      media: vi.fn(async () => ({
        url: "https://example.com/media.png",
        mimeType: "image/png"
      }))
    };
    setGlobalClient(mockClient);
  });

  it("generate_text uses client.text()", async () => {
    const { generateText } = await import("../mcp-server.js");

    const result = await generateText({
      bot_name: "Claude-Haiku-4.5",
      message: "Hello"
    });

    expect(mockClient.text).toHaveBeenCalledWith({
      model: "Claude-Haiku-4.5",
      prompt: "Hello",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "Hello from bot" }]);
  });

  it("generate_text passes params", async () => {
    const { generateText } = await import("../mcp-server.js");

    await generateText({
      bot_name: "test-bot",
      message: "Test",
      params: { temperature: "0.5" }
    });

    expect(mockClient.text).toHaveBeenCalledWith({
      model: "test-bot",
      prompt: "Test",
      params: { temperature: "0.5" }
    });
  });

  it("generate_image uses client.media() with default bot", async () => {
    const { generateImage } = await import("../mcp-server.js");
    const profile = getAgentProfile("generic");
    if (!profile) throw new Error("Missing generic profile in test");

    const result = await generateImage({
      prompt: "A sunset"
    }, profile);

    expect(mockClient.media).toHaveBeenCalledWith("image", {
      model: DEFAULT_IMAGE_BOT,
      prompt: "A sunset",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "https://example.com/media.png" }]);
  });

  it("generate_image uses custom bot_name", async () => {
    const { generateImage } = await import("../mcp-server.js");
    const profile = getAgentProfile("generic");
    if (!profile) throw new Error("Missing generic profile in test");

    await generateImage({
      prompt: "A cat",
      bot_name: "custom-image-bot"
    }, profile);

    expect(mockClient.media).toHaveBeenCalledWith("image", {
      model: "custom-image-bot",
      prompt: "A cat",
      params: undefined
    });
  });

  it("generate_video uses client.media() with default bot", async () => {
    const { generateVideo } = await import("../mcp-server.js");
    const profile = getAgentProfile("generic");
    if (!profile) throw new Error("Missing generic profile in test");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/video.mp4",
      mimeType: "video/mp4"
    }));

    const result = await generateVideo({
      prompt: "A rocket launch"
    }, profile);

    expect(mockClient.media).toHaveBeenCalledWith("video", {
      model: DEFAULT_VIDEO_BOT,
      prompt: "A rocket launch",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "https://example.com/video.mp4" }]);
  });

  it("generate_audio uses client.media() with default bot", async () => {
    const { generateAudio } = await import("../mcp-server.js");
    const profile = getAgentProfile("generic");
    if (!profile) throw new Error("Missing generic profile in test");

    mockClient.media = vi.fn(async () => ({
      url: "https://example.com/audio.mp3",
      mimeType: "audio/mp3"
    }));

    const result = await generateAudio({
      prompt: "Hello world"
    }, profile);

    expect(mockClient.media).toHaveBeenCalledWith("audio", {
      model: DEFAULT_AUDIO_BOT,
      prompt: "Hello world",
      params: undefined
    });
    expect(result).toEqual([{ type: "text", text: "https://example.com/audio.mp3" }]);
  });

  it("generate_image throws when no URL is returned", async () => {
    const { generateImage } = await import("../mcp-server.js");
    const profile = getAgentProfile("generic");
    if (!profile) throw new Error("Missing generic profile in test");

    mockClient.media = vi.fn(async () => ({
      content: "Error message"
    }));

    await expect(generateImage({ prompt: "Test" }, profile)).rejects.toThrow(
      `Model "${DEFAULT_IMAGE_BOT}" did not return an image URL`
    );
  });

  it("returns rich image content when agent supports it", async () => {
    const { generateImage } = await import("../mcp-server.js");
    const profile = getAgentProfile("claude-code");
    if (!profile) throw new Error("Missing claude-code profile in test");

    mockClient.media = vi.fn(async () => ({
      data: "BASE64IMAGE",
      mimeType: "image/png"
    }));

    const result = await generateImage({ prompt: "A logo" }, profile);

    expect(result).toEqual([
      { type: "image", data: "BASE64IMAGE", mimeType: "image/png" }
    ]);
  });
});
