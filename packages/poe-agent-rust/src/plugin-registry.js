import { spec as systemPrompt } from "./plugin-system-prompt.js";
import { spec as files } from "./plugin-files.js";
import { spec as shell } from "./plugin-shell.js";
import { spec as web } from "./plugin-web.js";
import { spec as memory } from "./plugin-memory.js";
import { spec as responses } from "./plugin-openai-responses.js";
import { spec as chat } from "./plugin-openai-chat-completions.js";
import { spec as compaction } from "./plugin-compaction.js";
import { spec as policy } from "./plugin-policy.js";
export const builtinPluginRegistry = new Map(
  [systemPrompt, files, shell, web, memory, responses, chat, compaction, policy].map((spec) => [
    spec.name,
    Object.freeze(spec)
  ])
);
