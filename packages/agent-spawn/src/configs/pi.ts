import type { CliSpawnConfig } from "../types.js";

const ALL_BUILTIN_TOOLS = "read,bash,edit,write,grep,find,ls";
const EDIT_TOOLS = "read,edit,write,grep,find,ls";
const READ_ONLY_TOOLS = "read,grep,find,ls";

export const piSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "pi",
  adapter: "pi",
  defaultArgs: ["--mode", "json", "--print"],
  defaultArgsPosition: "beforePrompt",
  modelFlag: "--model",
  modelStripProviderPrefix: false,
  modes: {
    yolo: ["--tools", ALL_BUILTIN_TOOLS, "--approve"],
    edit: ["--tools", EDIT_TOOLS, "--no-approve"],
    read: ["--tools", READ_ONLY_TOOLS, "--no-approve"]
  },
  stdinMode: {
    omitPrompt: true,
    extraArgs: []
  },
  interactive: {
    defaultArgs: []
  },
  resume: {
    args: (threadId) => ["--session", threadId],
    position: "beforePrompt"
  }
};
