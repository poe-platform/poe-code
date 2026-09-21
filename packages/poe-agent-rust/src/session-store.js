import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { native } from "./native.js";
function safeId(value) {
  if (!native.agentSessionValid(value)) throw Error(native.agentSessionError(String(value)));
}
export function createAgentSessionStore(options = {}) {
  const fs = options.fs ?? fsPromises,
    directory = path.join(options.homeDir ?? os.homedir(), ".poe-code", "sessions");
  return {
    async load(id) {
      safeId(id);
      const file = path.join(directory, `${id}.json`);
      let source;
      try {
        source = String(await fs.readFile(file, "utf8"));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
        throw error;
      }
      const outcome = native.agentSessionDecode(source);
      if (outcome.status === "ok") return outcome.value;
      if (outcome.status === "syntax") {
        let message = outcome.message;
        if (!outcome.bounded)
          try {
            JSON.parse(source);
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
        throw Error(`Unable to parse poe-agent session at ${file}: ${message}`);
      }
      if (outcome.status === "version")
        throw Error(
          `Unsupported poe-agent session version ${String(outcome.hasVersion ? outcome.version : undefined)} at ${file}.`
        );
      throw Error(`Invalid poe-agent session at ${file}.`);
    },
    async save(session) {
      safeId(session.threadId);
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `${session.threadId}.json`);
      await fs.writeFile(file, JSON.stringify(session, null, 2) + "\n", "utf8");
    }
  };
}
