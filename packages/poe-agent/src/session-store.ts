import { getFsBridgeProvider } from "@poe-code/safe-fs/bridge";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { agentFsBridge } from "./runtime/filesystem.js";
import { fsPromises } from "#agent-platform";
import { hostEnvironment as os } from "#agent-platform";
import { nativePath as path } from "#agent-platform";
import { assertSafeSessionId } from "./runtime/session/session-id.js";
import type { ChatMessage } from "./runtime/types.js";

interface SessionStoreFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string | Uint8Array>;
  writeFile(
    path: string,
    content: string,
    options?: "utf8" | { encoding: "utf8"; flag?: string }
  ): Promise<unknown>;
}

export interface PersistedAgentSession {
  version: 1;
  threadId: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface AgentSessionStore {
  load(threadId: string): Promise<PersistedAgentSession | undefined>;
  save(session: PersistedAgentSession): Promise<void>;
}

export function createAgentSessionStore(
  options: {
    homeDir?: string;
    fs?: SessionStoreFs | FileSystem;
    signal?: AbortSignal;
  } = {}
): AgentSessionStore {
  const fs = options.fs && "capabilities" in options.fs ? agentFsBridge(options.fs, { signal: options.signal }) : options.fs ?? fsPromises;
  const paths = getFsBridgeProvider(fs) ? path.posix : path;
  const sessionsDir = paths.join(options.homeDir ?? (options.fs && "capabilities" in options.fs ? "/" : os.homedir()), ".poe-code", "sessions");

  return {
    async load(threadId: string): Promise<PersistedAgentSession | undefined> {
      assertSafeSessionId(threadId);
      const filePath = paths.join(sessionsDir, `${threadId}.json`);
      let serialized: string;
      try {
        const raw = await fs.readFile(filePath, "utf8");
        serialized = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      } catch (error) {
        if (isMissingFileError(error)) {
          return undefined;
        }
        throw error;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized);
      } catch (error) {
        throw new Error(
          `Unable to parse poe-agent session at ${filePath}: ${toErrorMessage(error)}`
        );
      }

      if (!isPersistedAgentSession(parsed)) {
        const version = getVersion(parsed);
        if (version !== 1) {
          throw new Error(
            `Unsupported poe-agent session version ${String(version)} at ${filePath}.`
          );
        }
        throw new Error(`Invalid poe-agent session at ${filePath}.`);
      }

      return parsed;
    },

    async save(session: PersistedAgentSession): Promise<void> {
      assertSafeSessionId(session.threadId);
      await fs.mkdir(sessionsDir, { recursive: true });
      const filePath = paths.join(sessionsDir, `${session.threadId}.json`);
      await fs.writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    }
  };
}

function isPersistedAgentSession(value: unknown): value is PersistedAgentSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const session = value as Record<string, unknown>;
  return (
    session.version === 1 &&
    typeof session.threadId === "string" &&
    typeof session.model === "string" &&
    typeof session.cwd === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    Array.isArray(session.messages) &&
    session.messages.every(isChatMessage)
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Record<string, unknown>;
  if (!isChatRole(message.role)) {
    return false;
  }

  return typeof message.content === "string" || isToolResultPartArray(message.content);
}

function isChatRole(value: unknown): value is ChatMessage["role"] {
  switch (value) {
    case "system":
    case "user":
    case "assistant":
    case "tool":
      return true;
    default:
      return false;
  }
}

function isToolResultPartArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isToolResultPart);
}

function isToolResultPart(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const part = value as Record<string, unknown>;
  switch (part.type) {
    case "text":
      return typeof part.text === "string";
    case "image":
      return typeof part.mimeType === "string" && typeof part.data === "string";
    case "error":
      return (
        typeof part.code === "string" &&
        typeof part.message === "string" &&
        typeof part.retriable === "boolean"
      );
    default:
      return false;
  }
}

function getVersion(value: unknown): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>).version
    : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
