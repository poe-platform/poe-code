import { describe, it, expect, vi } from "vitest";
import { createPoeClient } from "../src/services/llm-client.js";
import type { HttpClient } from "../src/cli/http.js";

const baseUrl = "https://api.poe.com/v1";

function createHttpClientMock(response: unknown): HttpClient {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response
  }));
}

describe("createPoeClient", () => {
  it("sends extra_body for text params", async () => {
    const httpClient = createHttpClientMock({
      choices: [{ message: { content: "hi" } }]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.text({
      model: "Text-Model",
      prompt: "Hello",
      params: { thinking_budget: "123" }
    });

    expect(response).toEqual({ content: "hi" });
    expect(httpClient).toHaveBeenCalledWith(
      "https://api.poe.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret"
        }
      })
    );

    const call = (httpClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      model: "Text-Model",
      messages: [{ role: "user", content: "Hello" }],
      extra_body: { thinking_budget: "123" }
    });
  });

  it("omits extra_body when no params are provided", async () => {
    const httpClient = createHttpClientMock({
      choices: [{ message: { content: "ok" } }]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    await client.text({
      model: "Text-Model",
      prompt: "Hello"
    });

    const call = (httpClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      model: "Text-Model",
      messages: [{ role: "user", content: "Hello" }]
    });
  });

  it("parses media responses from JSON content", async () => {
    const httpClient = createHttpClientMock({
      choices: [
        {
          message: {
            content: JSON.stringify({
              url: "https://example.com/out.mp4",
              mimeType: "video/mp4"
            })
          }
        }
      ]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.media("video", {
      model: "Video-Model",
      prompt: "Launch",
      params: { resolution: "1080p" }
    });

    expect(response).toEqual({
      url: "https://example.com/out.mp4",
      mimeType: "video/mp4"
    });

    const call = (httpClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = call[1]?.body as string;
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({
      model: "Video-Model",
      messages: [{ role: "user", content: "Launch" }],
      extra_body: { resolution: "1080p" }
    });
  });

  it("accepts media responses as raw URLs", async () => {
    const httpClient = createHttpClientMock({
      choices: [
        {
          message: {
            content: "https://example.com/out.mp3"
          }
        }
      ]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.media("audio", {
      model: "Audio-Model",
      prompt: "Hello"
    });

    expect(response).toEqual({ url: "https://example.com/out.mp3" });
  });

  it("returns content when no URL found", async () => {
    const httpClient = createHttpClientMock({
      choices: [
        {
          message: {
            content: "Sorry, I cannot generate images."
          }
        }
      ]
    });

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    const response = await client.media("image", {
      model: "Text-Model",
      prompt: "Draw a cat"
    });

    expect(response).toEqual({ content: "Sorry, I cannot generate images." });
  });

  it("includes status and body in API errors", async () => {
    const httpClient: HttpClient = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid API key" }),
      text: async () => "Invalid API key"
    }));

    const client = createPoeClient({
      apiKey: "secret",
      baseUrl,
      httpClient
    });

    await expect(
      client.text({ model: "Text-Model", prompt: "Hello" })
    ).rejects.toMatchObject({
      message: "Poe API error (401): Invalid API key",
      httpStatus: 401
    });
  });
});
