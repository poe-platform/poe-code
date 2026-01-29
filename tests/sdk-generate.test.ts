import { describe, it, expect, afterEach, vi } from "vitest";
import { generate, generateAudio, generateImage, generateVideo } from "../src/sdk/generate.js";
import { setGlobalClient } from "../src/services/client-instance.js";
import type { LlmClient } from "../src/services/llm-client.js";
import { DEFAULT_TEXT_MODEL } from "../src/cli/constants.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("SDK generate", () => {
  it("returns text content using the global client", async () => {
    delete process.env.POE_TEXT_MODEL;
    const client: LlmClient = {
      text: vi.fn(async (request) => ({
        content: `model:${request.model} prompt:${request.prompt}`
      })),
      media: vi.fn(async () => ({ url: "unused" }))
    };
    setGlobalClient(client);

    const response = await generate("Hello", { model: "Custom" });

    expect(response).toEqual({
      content: "model:Custom prompt:Hello"
    });
  });

  it("uses explicit model option over env var", async () => {
    process.env.POE_TEXT_MODEL = "Env-Model";

    const client: LlmClient = {
      text: vi.fn(async (request) => ({ content: request.model })),
      media: vi.fn(async () => ({ url: "unused" }))
    };
    setGlobalClient(client);

    const response = await generate("Hello", { model: "Option-Model" });

    expect(response).toEqual({ content: "Option-Model" });
  });

  it("uses env var when no model option provided", async () => {
    process.env.POE_TEXT_MODEL = "Env-Model";

    const client: LlmClient = {
      text: vi.fn(async (request) => ({ content: request.model })),
      media: vi.fn(async () => ({ url: "unused" }))
    };
    setGlobalClient(client);

    const response = await generate("Hello");

    expect(response).toEqual({ content: "Env-Model" });
  });

  it("uses default model when no option or env var", async () => {
    delete process.env.POE_TEXT_MODEL;

    const client: LlmClient = {
      text: vi.fn(async (request) => ({ content: request.model })),
      media: vi.fn(async () => ({ url: "unused" }))
    };
    setGlobalClient(client);

    const response = await generate("Hello");

    expect(response).toEqual({ content: DEFAULT_TEXT_MODEL });
  });

  it("uses media helpers with params", async () => {
    delete process.env.POE_IMAGE_MODEL;
    delete process.env.POE_VIDEO_MODEL;
    delete process.env.POE_AUDIO_MODEL;
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "unused" })),
      media: vi.fn(async (_type, request) => ({
        url: `url:${request.model}`,
        mimeType: "image/png"
      }))
    };
    setGlobalClient(client);

    const image = await generateImage("A sunset", {
      model: "Image-Model",
      params: { aspect_ratio: "16:9" }
    });
    const video = await generateVideo("Ocean waves", {
      model: "Video-Model"
    });
    const audio = await generateAudio("Hello", {
      model: "Audio-Model"
    });

    expect(image).toEqual({ url: "url:Image-Model", mimeType: "image/png" });
    expect(video).toEqual({ url: "url:Video-Model", mimeType: "image/png" });
    expect(audio).toEqual({ url: "url:Audio-Model", mimeType: "image/png" });
  });

  it("throws when prompt is empty", async () => {
    const client: LlmClient = {
      text: vi.fn(async () => ({ content: "ok" })),
      media: vi.fn(async () => ({ url: "ok" }))
    };
    setGlobalClient(client);

    await expect(generate("")).rejects.toThrow("Prompt is required");
  });
});
