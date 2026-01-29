import * as fsPromises from "node:fs/promises";
import { createCliMain } from "../src/cli/bootstrap.js";
import { createProgram } from "../src/cli/program.js";
import { setGlobalClient } from "../src/services/client-instance.js";
import { createPoeClient } from "../src/services/llm-client.js";
import type { LlmClient } from "../src/services/llm-client.js";
import type { FileSystem } from "../src/utils/file-system.js";
import { getPoeApiKey } from "../src/sdk/credentials.js";
import { createSnapshotClient } from "../tests/helpers/snapshot-client.js";
import { parseSnapshotConfig } from "../tests/helpers/snapshot-config.js";
import { createNodeHttpClient } from "../tests/helpers/http-client.js";
import { loadTestEnv } from "../tests/test-env.js";

const fsAdapter = fsPromises as unknown as FileSystem;

const fallbackClient: LlmClient = {
  text: async () => {
    throw new Error("Unexpected LLM invocation. Configure POE_SNAPSHOT_MODE or provide credentials.");
  },
  media: async () => {
    throw new Error("Unexpected LLM invocation. Configure POE_SNAPSHOT_MODE or provide credentials.");
  }
};

loadTestEnv();

await initializeSnapshotClient();

const main = createCliMain(createProgram);
void main();

async function initializeSnapshotClient(): Promise<void> {
  const config = parseSnapshotConfig(process.env);
  if (!config) {
    return;
  }

  const baseClient = await resolveBaseClient(config.mode, config.onMiss);
  setGlobalClient(
    createSnapshotClient(baseClient, {
      mode: config.mode,
      snapshotDir: config.snapshotDir,
      onMiss: config.onMiss,
      fs: fsAdapter
    })
  );
}

async function resolveBaseClient(
  mode: "record" | "playback",
  onMiss: "error" | "warn" | "passthrough"
): Promise<LlmClient> {
  if (mode === "playback" && onMiss === "error") {
    return fallbackClient;
  }
  const apiKey = await getPoeApiKey();
  const baseUrl = process.env.POE_API_BASE_URL?.trim() || "https://api.poe.com/v1";
  const httpClient = createNodeHttpClient();
  return createPoeClient({ apiKey, baseUrl, httpClient });
}
