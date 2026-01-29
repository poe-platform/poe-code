import * as fsPromises from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { setTemplateLoader } from "../src/utils/templates.js";
import { templateFixtures } from "./template-fixtures.js";
import { setGlobalClient } from "../src/services/client-instance.js";
import type { LlmClient } from "../src/services/llm-client.js";
import type { FileSystem } from "../src/utils/file-system.js";
import { createSnapshotClient, type SnapshotClient } from "./helpers/snapshot-client.js";
import { parseSnapshotConfig } from "./helpers/snapshot-config.js";
import { createNodeHttpClient } from "./helpers/http-client.js";
import { createPoeClient } from "../src/services/llm-client.js";
import { getPoeApiKey } from "../src/sdk/credentials.js";

process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";

beforeAll(() => {
  setTemplateLoader(async (relativePath) => {
    const template = templateFixtures.get(relativePath);
    if (!template) {
      throw new Error(`Missing template fixture for ${relativePath}`);
    }
    return template;
  });
});

afterAll(setTemplateLoader.bind(null, null));

const fetchMock = vi.fn(async () => {
  throw new Error("Unexpected fetch invocation. Provide a mock implementation.");
});

vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    throw new Error("Unexpected fetch invocation. Provide a mock implementation.");
  });
});

const defaultClient: LlmClient = {
  text: async () => {
    throw new Error("Unexpected LLM invocation. Provide a mock client.");
  },
  media: async () => {
    throw new Error("Unexpected LLM invocation. Provide a mock client.");
  }
};

const fsAdapter = fsPromises as unknown as FileSystem;
let snapshotDefault: LlmClient = defaultClient;
let snapshotClient: SnapshotClient | null = null;

beforeAll(async () => {
  const config = parseSnapshotConfig(process.env);
  const baseClient = await resolveSnapshotBaseClient(config.mode, config.onMiss);
  snapshotClient = createSnapshotClient(baseClient, {
    mode: config.mode,
    snapshotDir: config.snapshotDir,
    onMiss: config.onMiss,
    fs: fsAdapter
  });
  snapshotDefault = snapshotClient;
});

afterAll(async () => {
  if (snapshotClient) {
    await snapshotClient.persistAccessedKeys();
  }
});

beforeEach(() => {
  setGlobalClient(snapshotDefault);
});

async function resolveSnapshotBaseClient(
  mode: "record" | "playback",
  onMiss: "error" | "warn" | "passthrough"
): Promise<LlmClient> {
  if (mode === "playback" && onMiss === "error") {
    return defaultClient;
  }
  const apiKey = await getPoeApiKey();
  const baseUrl = process.env.POE_API_BASE_URL?.trim() || "https://api.poe.com/v1";
  const httpClient = createNodeHttpClient();
  return createPoeClient({ apiKey, baseUrl, httpClient });
}
