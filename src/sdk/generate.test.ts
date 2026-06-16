import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPoeApiKeyMock = vi.hoisted(() => vi.fn<() => Promise<string>>());
const createPoeClientMock = vi.hoisted(() => vi.fn());
const generatedClientState = vi.hoisted(() => ({ value: undefined as unknown }));
const getGlobalClientMock = vi.hoisted(() =>
  vi.fn(() => {
    if (generatedClientState.value === undefined) {
      throw new Error("LLM client not initialized.");
    }
    return generatedClientState.value;
  })
);
const setGlobalClientMock = vi.hoisted(() =>
  vi.fn((client: unknown) => {
    generatedClientState.value = client;
  })
);

vi.mock("./credentials.js", () => ({
  getPoeApiKey: getPoeApiKeyMock
}));

vi.mock("../services/llm-client.js", () => ({
  createPoeClient: createPoeClientMock
}));

vi.mock("../services/client-instance.js", () => ({
  getGlobalClient: getGlobalClientMock,
  setGlobalClient: setGlobalClientMock
}));

import { generate } from "./generate.js";

const originalPoeApiKey = process.env.POE_API_KEY;
const originalPoeBaseUrl = process.env.POE_BASE_URL;
const originalPoeApiBaseUrl = process.env.POE_API_BASE_URL;

describe("SDK generated Poe client", () => {
  beforeEach(() => {
    delete process.env.POE_API_KEY;
    delete process.env.POE_BASE_URL;
    delete process.env.POE_API_BASE_URL;
    getPoeApiKeyMock.mockReset();
    createPoeClientMock.mockReset();
    generatedClientState.value = undefined;
    getGlobalClientMock.mockClear();
    setGlobalClientMock.mockClear();
    createPoeClientMock.mockImplementation(({ apiKey, baseUrl }) => ({
      text: vi.fn(async () => ({ content: `${apiKey}@${baseUrl}` })),
      media: vi.fn()
    }));
  });

  afterEach(() => {
    restoreEnv("POE_API_KEY", originalPoeApiKey);
    restoreEnv("POE_BASE_URL", originalPoeBaseUrl);
    restoreEnv("POE_API_BASE_URL", originalPoeApiBaseUrl);
  });

  it("uses POE_BASE_URL when creating a client", async () => {
    getPoeApiKeyMock.mockResolvedValue("environment-key");
    process.env.POE_BASE_URL = "https://configured.example.invalid/v1";

    await expect(generate("hello", { model: "test-model" })).resolves.toEqual({
      content: "environment-key@https://configured.example.invalid/v1"
    });
    expect(createPoeClientMock).toHaveBeenCalledWith({
      apiKey: "environment-key",
      baseUrl: "https://configured.example.invalid/v1"
    });
  });

  it("prefers POE_API_BASE_URL over POE_BASE_URL when both are set", async () => {
    getPoeApiKeyMock.mockResolvedValue("environment-key");
    process.env.POE_BASE_URL = "https://provider.example.invalid/v1";
    process.env.POE_API_BASE_URL = "https://api.example.invalid/v1";

    await expect(generate("hello", { model: "test-model" })).resolves.toEqual({
      content: "environment-key@https://api.example.invalid/v1"
    });
    expect(createPoeClientMock).toHaveBeenCalledWith({
      apiKey: "environment-key",
      baseUrl: "https://api.example.invalid/v1"
    });
  });

  it("refreshes automatically created clients when connection settings change", async () => {
    getPoeApiKeyMock.mockResolvedValueOnce("first-key").mockResolvedValueOnce("second-key");
    process.env.POE_API_BASE_URL = "https://first.example.invalid/v1";

    await expect(generate("first", { model: "test-model" })).resolves.toEqual({
      content: "first-key@https://first.example.invalid/v1"
    });

    process.env.POE_API_BASE_URL = "https://second.example.invalid/v1";
    await expect(generate("second", { model: "test-model" })).resolves.toEqual({
      content: "second-key@https://second.example.invalid/v1"
    });

    expect(createPoeClientMock).toHaveBeenNthCalledWith(2, {
      apiKey: "second-key",
      baseUrl: "https://second.example.invalid/v1"
    });
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
