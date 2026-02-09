import type { CliSpawnConfig } from "../types.js";

export const kimiSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "kimi",
  // ACP adapter support: yes (adapter: "kimi").
  // Kimi's `--output-format stream-json` emits OpenAI-style `{ role, content }` JSON
  // (no `{ event, ... }` field), so it needs the Kimi adapter (not "native").
  adapter: "kimi",
  promptFlag: "-p",
  defaultArgs: ["--print", "--output-format", "stream-json"],
  modes: {
    yolo: ["--yolo"],
    edit: [],
    read: []
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: ["--input-format", "stream-json"]
  },
  interactive: {
    defaultArgs: [],
    promptFlag: "-p"
  },
  resumeCommand: (threadId, cwd) => ["--session", threadId, "--work-dir", cwd]
};
