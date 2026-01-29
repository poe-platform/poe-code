import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import type { FileSystem } from "../../src/utils/file-system.js";
import type {
  LlmClient,
  LlmRequest,
  LlmResponse
} from "../../src/services/llm-client.js";

export type SnapshotMode = "record" | "playback";
export type SnapshotMissBehavior = "error" | "warn" | "passthrough";

export interface SnapshotOptions {
  mode: SnapshotMode;
  snapshotDir: string;
  onMiss: SnapshotMissBehavior;
  fs: FileSystem;
  now?: () => Date;
}

export interface SnapshotRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  params?: Record<string, string>;
  type?: "text" | "image" | "video" | "audio";
}

export interface SnapshotEntry {
  key: string;
  request: SnapshotRequest;
  response: LlmResponse;
  metadata: {
    recordedAt: string;
    model: string;
    type?: "text" | "image" | "video" | "audio";
  };
}

export class SnapshotMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotMissingError";
  }
}

export interface SnapshotClient extends LlmClient {
  /** Returns all snapshot keys accessed during this session */
  getAccessedKeys(): Set<string>;
  /** Persists accessed keys to disk, merging with existing keys */
  persistAccessedKeys(): Promise<void>;
}

export function createSnapshotClient(
  baseClient: LlmClient,
  options: SnapshotOptions
): SnapshotClient {
  const accessedKeys = new Set<string>();

  return {
    async text(request) {
      return handleSnapshotRequest(baseClient, "text", request, options, accessedKeys);
    },
    async media(type, request) {
      return handleSnapshotRequest(baseClient, type, request, options, accessedKeys);
    },
    getAccessedKeys() {
      return accessedKeys;
    },
    async persistAccessedKeys() {
      if (accessedKeys.size === 0) {
        return;
      }
      const outputPath = join(options.snapshotDir, ".accessed-keys.json");

      // Merge with existing keys
      let existingKeys: string[] = [];
      try {
        const raw = await options.fs.readFile(outputPath, "utf8");
        existingKeys = JSON.parse(raw);
      } catch {
        // File doesn't exist or is invalid
      }

      const merged = new Set([...existingKeys, ...accessedKeys]);
      await options.fs.writeFile(outputPath, JSON.stringify(Array.from(merged), null, 2));
    }
  };
}

export function generateSnapshotKey(request: {
  model: string;
  messages: Array<{ role: string; content: string }>;
}): string {
  const normalized = JSON.stringify({
    model: request.model,
    messages: request.messages
  });
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  const safeModel = sanitizeModelName(request.model);
  return `${safeModel}-${hash}`;
}

async function handleSnapshotRequest(
  baseClient: LlmClient,
  type: "text" | "image" | "video" | "audio",
  request: LlmRequest,
  options: SnapshotOptions,
  accessedKeys: Set<string>
): Promise<LlmResponse> {
  const snapshotRequest = buildSnapshotRequest(type, request);
  const key = generateSnapshotKey(snapshotRequest);
  const snapshotPath = join(options.snapshotDir, `${key}.json`);

  accessedKeys.add(key);

  if (options.mode === "playback") {
    const cached = await loadSnapshot(options.fs, snapshotPath);
    if (cached) {
      return cached.response;
    }
    return handleMiss(baseClient, type, request, options, key);
  }

  const response = await dispatchRequest(baseClient, type, request);
  await saveSnapshot(options.fs, snapshotPath, {
    key,
    request: snapshotRequest,
    response,
    metadata: {
      recordedAt: (options.now ?? (() => new Date()))().toISOString(),
      model: request.model,
      type
    }
  });
  return response;
}

async function handleMiss(
  baseClient: LlmClient,
  type: "text" | "image" | "video" | "audio",
  request: LlmRequest,
  options: SnapshotOptions,
  key: string
): Promise<LlmResponse> {
  if (options.onMiss === "error") {
    throw new SnapshotMissingError(`Snapshot not found for ${key}`);
  }
  if (options.onMiss === "warn") {
    console.warn(`Snapshot not found for ${key}; falling back to live call.`);
  }
  return dispatchRequest(baseClient, type, request);
}

async function dispatchRequest(
  client: LlmClient,
  type: "text" | "image" | "video" | "audio",
  request: LlmRequest
): Promise<LlmResponse> {
  if (type === "text") {
    return client.text(request);
  }
  return client.media(type, request);
}

function buildSnapshotRequest(
  type: "text" | "image" | "video" | "audio",
  request: LlmRequest
): SnapshotRequest {
  const snapshot: SnapshotRequest = {
    model: request.model,
    messages: [{ role: "user", content: request.prompt }],
    type
  };
  if (request.params && Object.keys(request.params).length > 0) {
    snapshot.params = request.params;
  }
  return snapshot;
}

async function loadSnapshot(
  fs: FileSystem,
  snapshotPath: string
): Promise<SnapshotEntry | null> {
  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    return JSON.parse(raw) as SnapshotEntry;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function saveSnapshot(
  fs: FileSystem,
  snapshotPath: string,
  snapshot: SnapshotEntry
): Promise<void> {
  const dir = dirname(snapshotPath);
  if (dir.length > 0 && dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
}

function sanitizeModelName(model: string): string {
  const lower = model.toLowerCase();
  let result = "";
  for (const char of lower) {
    const code = char.charCodeAt(0);
    const isAlpha = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (isAlpha || isDigit || char === "-") {
      result += char;
    } else {
      result += "-";
    }
  }
  return result;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
