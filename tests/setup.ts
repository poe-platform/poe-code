import * as fsPromises from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, mock, setSystemTime, vi } from "bun:test";
import { setGlobalClient } from "../src/services/client-instance.js";
import type { LlmClient } from "../src/services/llm-client.js";
import type { FileSystem } from "../src/utils/file-system.js";
import { createSnapshotClient, type SnapshotClient } from "./helpers/snapshot-client.js";
import { parseSnapshotConfig, SNAPSHOT_DIR } from "./helpers/snapshot-config.js";
import { createNodeHttpClient } from "./helpers/http-client.js";
import { createPoeClient } from "../src/services/llm-client.js";
import { getPoeApiKey } from "../src/sdk/credentials.js";

// Patch vi with vitest-compatible shims missing from bun:test
const viAny = vi as any;
if (!viAny.mocked) {
  viAny.mocked = (fn: unknown) => fn;
}
if (!viAny.waitFor) {
  viAny.waitFor = async (fn: () => void | Promise<void>, opts?: { timeout?: number; interval?: number }) => {
    const timeout = opts?.timeout ?? 1000;
    const interval = opts?.interval ?? 50;
    const deadline = Date.now() + timeout;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await fn();
        return;
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    throw lastError;
  };
}
if (!viAny.advanceTimersByTimeAsync) {
  viAny.advanceTimersByTimeAsync = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    // Use microtask flush instead of setTimeout to avoid hanging with fake timers
    await Promise.resolve();
    await Promise.resolve();
  };
}
if (!viAny.setSystemTime) {
  viAny.setSystemTime = (now?: Date | number) => setSystemTime(now);
}
if (!viAny.resetModules) {
  viAny.resetModules = () => {
    // bun:test does not support module cache reset — no-op
  };
}
if (!viAny.importActual) {
  viAny.importActual = (moduleId: string) => Promise.resolve(require(moduleId));
}

process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";
(globalThis as Record<string, unknown>).__POE_REAL_CHILD_PROCESS_SPAWN__ ??= nodeSpawn;

mock.module("../src/cli/oauth-login.js", () => ({
  resolveApiKeyViaOAuth: async () => {
    throw new Error(
      "Unmocked browser open detected. Mock '../cli/oauth-login.js' in your test."
    );
  }
}));

const fetchMock = mock(async () => {
  throw new Error("Unexpected fetch invocation. Provide a mock implementation.");
});

globalThis.fetch = fetchMock as unknown as typeof fetch;

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
    snapshotDir: SNAPSHOT_DIR,
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
