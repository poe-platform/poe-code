import fsPromises from "node:fs/promises";
import path from "node:path";
import { native } from "./native.js";
function safeId(id) {
  if (!native.agentSessionValid(id)) throw Error(native.agentSessionError(String(id)));
}
export function createMemorySessionStore(sessionId) {
  safeId(sessionId);
  const state = new native.NativeAgentMemoryStore();
  return {
    sessionId,
    async append(entry) {
      const source = JSON.stringify(entry);
      if (source === undefined) JSON.parse(source);
      state.append(source);
    },
    async list() {
      return state.list();
    },
    async dispose() {
      state.clear();
    }
  };
}
export async function createJsonlSessionStore(sessionId, directory, options = {}) {
  safeId(sessionId);
  const fs = options.fs ?? fsPromises,
    file = path.join(directory, `${sessionId}.jsonl`);
  let writeQueue = Promise.resolve();
  await fs.mkdir(directory, { recursive: true });
  return {
    sessionId,
    async append(entry) {
      writeQueue = writeQueue.then(() =>
        fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8").then(() => undefined)
      );
      await writeQueue;
    },
    async list() {
      await writeQueue;
      let source;
      try {
        source = String(await fs.readFile(file, "utf8"));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      }
      const result = native.agentSessionLogDecode(source);
      if (result.status === "ok") return result.entries;
      if (result.status === "syntax")
        throw Error(`Unable to parse poe-agent session entry at ${file}:${result.line}.`);
      if (result.status === "limit")
        throw Error(`Rust session parser limit exceeded at ${file}:${result.line}.`);
      throw Error(`Invalid poe-agent session entry in ${file}.`);
    },
    async dispose() {
      await writeQueue;
    }
  };
}
