import type { AcpSpawnConfig, CliSpawnConfig } from "../types.js";
import { serializeOpenCodeMcpEnv } from "./mcp.js";

/**
 * OpenCode JSON output format (empirically observed)
 *
 * OpenCode can emit "raw JSON events" when running a prompt via:
 * - `opencode run "<prompt>" --format json ...`
 *
 * Key observations (OpenCode CLI v1.1.47):
 * - Output is **NDJSON / line-delimited JSON**: one JSON object per stdout line.
 * - Each line is an event object with a top-level `type` string (NOT ACP's `{ event: ... }`).
 * - Common top-level fields:
 *   - `type`: `"step_start" | "text" | "tool_use" | "step_finish" | ...`
 *   - `timestamp`: number (ms since epoch)
 *   - `sessionID`: string (e.g. `"ses_..."`)
 *   - `part`: object with event-specific payload
 *
 * `text` events:
 * ```ts
 * {
 *   type: "text",
 *   sessionID: "ses_...",
 *   part: {
 *     type: "text",
 *     messageID: "msg_...",
 *     text: "Hello ...",
 *     time: { start: 1770000000000, end: 1770000000000 }
 *   }
 * }
 * ```
 *
 * Tool calls (`tool_use`):
 * - Represented as a single event with `part.type: "tool"` and `state.status`.
 * - `state.input` includes tool arguments; `state.output` is the tool result string.
 * ```ts
 * {
 *   type: "tool_use",
 *   sessionID: "ses_...",
 *   part: {
 *     type: "tool",
 *     callID: "call_...",
 *     tool: "bash",
 *     state: {
 *       status: "completed",
 *       input: { command: "echo hello", description: "..." },
 *       output: "hello\n"
 *     }
 *   }
 * }
 * ```
 *
 * Step boundaries:
 * - `step_start` and `step_finish` wrap a single model/tool turn.
 * - `step_finish.part.tokens` contains token accounting:
 *   `{ input, output, reasoning, cache: { read, write } }`
 *
 * Negative cases / gotchas:
 * - Some failures (e.g. invalid `--model` / unknown provider) can print a non-JSON stack trace
 *   before any JSON events are emitted, even with `--format json`.
 * - If `--format json` is ever removed upstream, OpenCode will need a text-mode fallback
 *   (no streaming event adapter).
 */
export const openCodeSpawnConfig: CliSpawnConfig = {
  kind: "cli",
  agentId: "opencode",
  // ACP adapter support: yes (adapter: "opencode").
  // OpenCode's `--format json` emits NDJSON events with `{ type, sessionID, part }`
  // (no `{ event, ... }` field), so it needs the OpenCode adapter (not "native").
  adapter: "opencode",
  promptFlag: "run",
  modelFlag: "--model",
  modelStripProviderPrefix: false,
  modelTransform: (model) => {
    return model.startsWith("poe/") ? model : `poe/${model}`;
  },
  defaultArgs: ["--format", "json"],
  modes: {
    // No auto: `opencode run` never asks; permissions come from opencode.json.
    yolo: [],
    edit: [],
    read: ["--agent", "plan"]
  },
  interactive: {
    defaultArgs: [],
    promptFlag: "--prompt"
  },
  resume: {
    args: (threadId) => ["--session", threadId],
    hintArgs: (threadId, cwd) => [cwd, "--session", threadId]
  },
  mcpEnv: serializeOpenCodeMcpEnv
};

export const openCodeAcpSpawnConfig: AcpSpawnConfig = {
  kind: "acp",
  agentId: "opencode",
  acpArgs: ["acp"],
  skipAuth: true,
  mcpEnv: serializeOpenCodeMcpEnv,
};
