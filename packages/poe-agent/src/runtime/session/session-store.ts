import fsPromises from "node:fs/promises";
import path from "node:path";
import { isSessionEntry, type SessionEntry } from "./entry-types.js";

type JsonlSessionStoreFs = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  appendFile(path: string, data: string, encoding: "utf8"): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string | Buffer>;
};

export interface SessionStore {
  readonly sessionId: string;
  append(entry: SessionEntry): Promise<void>;
  list(): Promise<SessionEntry[]>;
  dispose(): Promise<void>;
}

export function createMemorySessionStore(sessionId: string): SessionStore {
  const entries: SessionEntry[] = [];

  return {
    sessionId,

    async append(entry: SessionEntry): Promise<void> {
      entries.push(cloneEntry(entry));
    },

    async list(): Promise<SessionEntry[]> {
      return entries.map(cloneEntry);
    },

    async dispose(): Promise<void> {
      entries.length = 0;
    }
  };
}

export async function createJsonlSessionStore(
  sessionId: string,
  directory: string,
  options: { fs?: JsonlSessionStoreFs } = {}
): Promise<SessionStore> {
  const fs = options.fs ?? fsPromises;
  const filePath = path.join(directory, `${sessionId}.jsonl`);
  let writeQueue = Promise.resolve();

  await fs.mkdir(directory, { recursive: true });

  return {
    sessionId,

    async append(entry: SessionEntry): Promise<void> {
      writeQueue = writeQueue.then(() =>
        fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8").then(() => undefined)
      );
      await writeQueue;
    },

    async list(): Promise<SessionEntry[]> {
      await writeQueue;
      let serialized: string;
      try {
        serialized = String(await fs.readFile(filePath, "utf8"));
      } catch (error) {
        if (isMissingFileError(error)) {
          return [];
        }
        throw error;
      }

      const entries: SessionEntry[] = [];
      for (const line of serialized.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          break;
        }

        if (!isSessionEntry(parsed)) {
          throw new Error(`Invalid poe-agent session entry in ${filePath}.`);
        }
        entries.push(parsed);
      }

      return entries;
    },

    async dispose(): Promise<void> {
      await writeQueue;
    }
  };
}

function cloneEntry(entry: SessionEntry): SessionEntry {
  return JSON.parse(JSON.stringify(entry)) as SessionEntry;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
