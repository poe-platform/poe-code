import { afterAll, beforeEach, vi } from "vitest";

// Reduce vi.waitFor polling interval from 50ms (default) to 10ms.
// Tests using vi.waitFor typically need just 1 retry, so this saves ~40ms per call
// across 52 call sites without affecting test correctness.
{
  const _originalWaitFor = vi.waitFor.bind(vi);
  (vi as any).waitFor = (callback: any, options?: any): any => {
    const normalized = typeof options === "number" ? { timeout: options } : options ?? {};
    return _originalWaitFor(callback, { interval: 10, ...normalized });
  };
}
import { setGlobalClient } from "../src/services/client-instance.js";
import type { LlmClient } from "../src/services/llm-client.js";
import type { SnapshotClient } from "./helpers/snapshot-client.js";

process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";

vi.mock("../src/cli/oauth-login.js", () => ({
  resolveApiKeyViaOAuth: async () => {
    throw new Error(
      "Unmocked browser open detected. Mock '../cli/oauth-login.js' in your test."
    );
  }
}));

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

let snapshotClient: SnapshotClient | null = null;
let snapshotClientPromise: Promise<SnapshotClient> | null = null;

const snapshotDefault: LlmClient = {
  async text(request) {
    return (await getSnapshotClient()).text(request);
  },
  async media(type, request) {
    return (await getSnapshotClient()).media(type, request);
  }
};

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
  const [{ getPoeApiKey }, { createNodeHttpClient }, { createPoeClient }] = await Promise.all([
    import("../src/sdk/credentials.js"),
    import("./helpers/http-client.js"),
    import("../src/services/llm-client.js")
  ]);
  const apiKey = await getPoeApiKey();
  const baseUrl = process.env.POE_API_BASE_URL?.trim() || "https://api.poe.com/v1";
  const httpClient = createNodeHttpClient();
  return createPoeClient({ apiKey, baseUrl, httpClient });
}

async function getSnapshotClient(): Promise<SnapshotClient> {
  if (snapshotClient !== null) {
    return snapshotClient;
  }
  if (snapshotClientPromise === null) {
    snapshotClientPromise = createDefaultSnapshotClient();
  }
  snapshotClient = await snapshotClientPromise;
  return snapshotClient;
}

async function createDefaultSnapshotClient(): Promise<SnapshotClient> {
  const [fsPromises, snapshotModule, configModule] = await Promise.all([
    import("node:fs/promises"),
    import("./helpers/snapshot-client.js"),
    import("./helpers/snapshot-config.js")
  ]);
  const config = configModule.parseSnapshotConfig(process.env);
  const baseClient = await resolveSnapshotBaseClient(config.mode, config.onMiss);

  return snapshotModule.createSnapshotClient(baseClient, {
    mode: config.mode,
    snapshotDir: configModule.SNAPSHOT_DIR,
    onMiss: config.onMiss,
    fs: fsPromises as unknown as import("../src/utils/file-system.js").FileSystem
  });
}
