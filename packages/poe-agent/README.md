# @poe-code/poe-agent

Composable agent runtime for Poe-backed coding agents.

The runtime is plugin-first: files, shell, web, MCP, memory, policy, compaction, scratchpad, skills, and spawn are all regular plugins. The core stays focused on orchestration.

## Quick start

```ts
import {
  agent,
  compactionPlugin,
  filesPlugin,
  memoryPlugin,
  policyPlugin,
  shellPlugin,
  systemPromptPlugin,
  webPlugin
} from "@poe-code/poe-agent";

const result = await agent()
  .model("anthropic/claude-sonnet-4.6")
  .use(systemPromptPlugin())
  .use(memoryPlugin({ cwd: process.cwd() }))
  .use(filesPlugin({ cwd: process.cwd() }))
  .use(shellPlugin({ cwd: process.cwd() }))
  .use(webPlugin())
  .use(policyPlugin({ mode: "edit" }))
  .use(compactionPlugin({ keepLastTurns: 3 }))
  .run("Fix the failing test", {
    apiKey: "<poe-api-key>",
    cwd: process.cwd()
  });

console.log(result.output);
```

## Runtime requirements

- `grep` in `filesPlugin()` shells out to `rg` (ripgrep). Install ripgrep and make sure `rg` is on `PATH`.
- `fetch_url`, `search_web`, and Poe model calls need network access.
- `createAgentSession()` only supports stdio MCP servers.

## Public API

### `agent()`

Returns a fluent builder:

- `.model(model)`
- `.use(plugin)`
- `.mcp(...configs)`
- `.acp(prompt, options?)`
- `.run(prompt, options?)`
- `.stream(prompt, options?)`

### `createAgentSession(options?)`

Compatibility wrapper that builds a session with:

- `openaiResponsesPlugin()`
- `openaiChatCompletionsPlugin()`
- `systemPromptPlugin()`
- `filesPlugin()`
- `shellPlugin()`
- `webPlugin()`

Use the builder API when you need memory, policy, compaction, skills, scratchpad, audit logging, or custom plugins.

## Run options

`agent().acp(...)`, `.run(...)`, and `.stream(...)` accept:

- `signal?: AbortSignal`
- `resume?: Pick<RunResult, "messages">`
- `skills?: string[]`
- `activeSkills?: string[]` — legacy alias for `skills`
- `maxIterations?: number`
- `acpModel?: AcpModel`
- `apiKey?: string`
- `baseUrl?: string`
- `fetch?: typeof fetch`
- `cwd?: string`
- `baseSystemPrompt?: string`
- `createSpawnSession?: AgentHostOptions["createSpawnSession"]`

## `createAgentSession()` options

- `model?: string` — required in practice
- `apiKey?: string`
- `cwd?: string`
- `allowedPaths?: string[]`
- `pluginsConfig?: Array<{ name: string; options?: unknown }>`
- `mcpServers?: Record<string, McpServerDefinition>`
- `baseUrl?: string`
- `fetch?: typeof fetch`
- `maxToolCallIterations?: number`
- `resume?: { messages: ChatMessage[] }`

Completed session history is available through `session.getHistory()`. Poe Agent resume sessions are stored as JSON under `~/.poe-code/sessions/` so the exact runtime message history can be reused losslessly.

`McpServerDefinition` supports both `stdio` and `http` at the type level, but `createAgentSession()` currently accepts only `stdio` definitions.

`pluginsConfig` resolves plugin names from the built-in registry. Supported names are:

- `openai-responses`
- `openai-chat-completions`
- `system-prompt`
- `files`
- `shell`
- `web`
- `memory`
- `compaction`
- `policy`

Example:

```ts
await createAgentSession({
  model: "anthropic/claude-sonnet-4.6",
  pluginsConfig: [
    { name: "system-prompt" },
    { name: "files", options: { allowedPaths: ["src"] } },
    { name: "memory" },
    { name: "policy", options: { mode: "read" } }
  ]
});
```

If `pluginsConfig` is omitted, `createAgentSession()` keeps the default bundle (`openai-responses`, `openai-chat-completions`, `system-prompt`, `files`, `shell`, `web`).

`mcpServers` stays separate from `pluginsConfig`; MCP servers still use the dedicated `mcpServers` option.

## Built-in plugins

### `auditLogPlugin(logPath)`

Appends a JSON line after each tool call.

### `compactionPlugin(options?)`

Options:

- `threshold?: number`
- `contextWindow?: number`
- `keepLastTurns?: number`
- `summarise?(messages): string | Promise<string>`

Defaults: `contextWindow` 200000, `threshold` 80% of `contextWindow`, `keepLastTurns` 3. When the estimated token count crosses the threshold, older context is summarized into a system message. The plugin also triggers `preCompaction` and `postCompaction` hooks.

### `environmentPlugin(cwd)`

Adds working-directory and Node-version context to the system prompt.

### `filesPlugin(options?)`

Options:

- `cwd?: string`
- `allowedPaths?: string[]`
- `fs?`
- `searchContent?`
- `globFiles?`

Tools:

- `read_file({ path, offset?, limit? })` — line-based pagination; returns an image `ToolResult` for supported image files
- `edit_file({ command, path, ... })`
  - `command: "str_replace"` supports `old_str`, `new_str`, `replace_all?`
  - `command: "create"` supports `file_text` and fails if the file exists
  - `command: "overwrite"` supports `file_text` and rewrites the full file
- `list_files({ path? })`
- `grep({ pattern, path?, glob?, output_mode?, line_numbers?, ignore_case? })`
- `glob({ pattern, path? })` — sorted by most recently modified first

### `gitContextPlugin(cwd)`

Adds `git status --short` and the last 5 commits to the system prompt.

### `maxIterationsPlugin(limit)`

Aborts the run after the configured iteration count.

### `mcpPlugin(config)`

Registers an MCP server through the normal plugin pipeline.

Config fields:

- `name: string`
- `command: string`
- `args?: string[]`
- `env?: Record<string, string>`
- `timeout?: number`
- `visibility?: "model" | "skill"`

### `memoryPlugin(options?)`

Options:

- `cwd?: string`
- `homeDir?: string`
- `fs?`

Loads memory from:

1. the nearest `AGENTS.md` found by walking up from `cwd`
2. `$HOME/.config/poe-code/AGENTS.md`

`AGENTS.md` supports `@relative/path.md` imports.

### `policyPlugin({ mode })`

Options:

- `mode: "read" | "edit" | "yolo" | (() => "read" | "edit" | "yolo")`

Policy is enforced from per-tool metadata instead of a central tool-name switch.

### `scratchpadPlugin()`

In-memory note storage:

- `write_note({ key, value })`
- `read_note({ key })`

### `shellPlugin(options?)`

Options:

- `cwd?: string`
- `allowedPaths?: string[]`
- `runCommand?`

Tools:

- `run_command({ command, cwd?, timeout?, run_in_background? })`
  - default timeout: 120 seconds
  - max timeout: 600 seconds
  - foreground runs honor `AbortSignal`
  - long-running stdout/stderr can emit `notification` hook events
- `read_background({ handle })`
- `kill_background({ handle })`

### `skillsPlugin(options)`

Options:

- `definitions: Record<string, string[] | { tools?: string[]; tags?: string[] }>`
- `skills?: string[] | (() => string[] | undefined)`
- `toolRegistry?`

Adds active-skill guidance and metadata to the prompt.

### `spawnPlugin()`

Adds `spawn({ task })`, which runs a fresh sub-agent and returns the child agent's `output` string.

### `systemPromptPlugin()`

Prepends the bundled `SYSTEM_PROMPT.md` once.

### `webPlugin(options?)`

Options:

- `searchWeb?`
- `fetch?`

Tools:

- `search_web({ query })`
- `fetch_url({ url, offset? })` — HTTP GET only; HTML is converted to markdown and paginated in 20,000-character pages

## Hooks

`AgentPlugin` supports:

- `sessionStart`
- `userPromptSubmit`
- `preIteration`
- `postIteration`
- `preToolUse`
- `postToolUse`
- `preCompaction`
- `postCompaction`
- `notification`
- `stop`

Each hook returns the existing `HookDecision` contract: `"skip" | "abort" | { reject: string } | void`.

## Tool results

Tools can return either a string or structured `ToolResult` parts:

- `{ type: "text", text }`
- `{ type: "image", mimeType, data }`
- `{ type: "error", code, message, retriable }`

This lets tools return screenshots/images and structured failures instead of only plain text.

## Environment variables

This package reads:

- `POE_AUTH_BACKEND` — passed to `auth-store` when resolving stored Poe credentials

Notes:

- `apiKey` run options take precedence over stored credentials.
- If `apiKey` is omitted, the runtime falls back to the credentials stored by `poe-code login`.
- `@poe-code/poe-agent` does not read `POE_API_KEY` directly.
