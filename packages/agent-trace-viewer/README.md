# @poe-code/agent-trace-viewer

Core SDK and CLI wiring for listing, loading, and summarizing normalized agent
traces. The package builds on `@poe-code/agent-traces` readers and powers
`poe-code traces`.

## CLI Usage

The poe-code CLI wires this package as `poe-code traces`.

```sh
poe-code traces [path] [--source claude codex pi poe-code] [--all-workspaces] [--since 30d] [--limit 50] [--json] [--yes] [--open] [--html-out <file>]
```

- `path`: Load a specific JSONL trace file and render its detail view.
- `--source <sources...>`: Restrict discovery to `claude`, `codex`, `pi`, and/or `poe-code`.
- `--all-workspaces`: Disable the current-workspace filter for sources that support workspace filtering.
- `--since <duration>`: Include only traces updated within a duration such as `30d`, `12h`, or `45m`.
- `--limit <n>`: Maximum discovered trace references to list. Defaults to `50`.
- `--json`: Emit machine-readable JSON. List mode emits trace references; path mode emits the loaded `TraceView` plus `subagents`.
- `--yes`: Skip the interactive explorer and print the trace list table.
- `--open`: Require `path`. Build a self-contained HTML page for the trace (including nested subagents inline under Task/Agent spawn turns) and open it with the platform browser. Incompatible with `--json`.
- `--html-out <file>`: Require `path`. Write the same self-contained HTML to this file without opening, unless `--open` is also set. Incompatible with `--json`.

Without `--yes`, `--json`, or a non-TTY stdin, list mode opens the interactive explorer. `Enter` opens the selected trace detail, `o` opens the selected trace as HTML in the browser, `s` drills into available subagent traces, `c` prints the trace path, and `r` refreshes discovery.

## Public API

### `listTraces(options)`

Discovers trace references from the registered trace readers, merges them, sorts by `updatedAt` descending, and applies a limit.

Options:

- `cwd: string`
- `homeDir: string`
- `fs: AgentTraceFileSystem`
- `sources?: AgentTraceSource[]`
- `allWorkspaces?: boolean`
- `since?: Date`
- `limit?: number`
- `sqlite?: SqliteTraceDatabaseFactory`

Readers that fail during discovery are skipped so one unavailable local trace store does not hide other sources.

### `loadTrace(reference, options)`

Loads a normalized trace by finding the reader whose `id` matches `reference.source`.

Returns `TraceView`, which is a `NormalizedTrace` plus:

- `context: ContextUsage`
- `breakdown: ContextBreakdown`

Context usage uses reported trace usage when available. Otherwise it uses the breakdown's measured token total.

Options beyond `fs`:

- `signal?: AbortSignal` — abandons token counting mid-way; partial results are never cached.
- `cacheDir?: string` — token cache directory. Defaults to `~/.cache/poe-code/trace-tokens` (or `$XDG_CACHE_HOME/poe-code/trace-tokens`). Exact breakdowns are cached per trace file, keyed by mtime and size.
- `deferExactTokens?: boolean` — on a cache miss, return a fast calibrated estimate (`breakdown.source === "estimated"`) and compute the exact count in the background, writing it to the cache when done. The interactive explorer uses this so browsing never waits on tokenization.
- `onExactBreakdown?: (breakdown) => void` — invoked when a deferred exact breakdown finishes.

### `computeContextBreakdown(trace, options?)`

Computes an estimated attribution of logged context into ordered categories:

- System prompt
- Skills
- MCP
- System reminders
- Tools
- Reasoning
- Messages
- Other

Skills are grouped by `skillName`, MCP turns by `mcpServer`, and tool turns by `toolName`.

By default (`mode: "exact"`) every turn is tokenized with `tokenfill` (`cl100k`), yielding to the event loop between batches so a large trace never blocks input. With `mode: "estimated"` a single 16KB sample calibrates a chars-per-token ratio applied to all turns; the result is marked `source: "estimated"` and rendered with a "counting exact tokens…" hint. Tool definitions are not present in any trace format, so the breakdown measures skill payloads, MCP/tool call inputs and outputs, reminders, and messages, not the schema block. For poe-code traces content is redacted, so its breakdown shows call counts with near-zero tokens; that is expected, not a bug.

### `loadSubagentSummaries(view, options)`

Loads child trace references from `view.children` and returns one summary per successfully loaded child.

Each child has its own context window. Child tokens are never added to the parent gauge or breakdown; the parent already pays for the child's returned tool result, which the breakdown counts under Tools.

### `loadTraceTree(root, options)`

Loads `root.children` recursively into a `TraceTreeNode` for HTML export. Failed children become `unavailable` placeholder nodes. Detects cycles and applies soft `maxDepth` / `maxNodes` caps.

### `renderTraceHtml(tree, options?)`

Pure function: builds a self-contained HTML document for a `TraceTreeNode`. Subagent panels are placed inline in the conversation after matching `Task` / `Agent` tool_use turns (collapsed by default). Unmatched children append under an “Additional subagents” fallback. Optional `generatedAt` and `pageSizeLimitBytes` control the footer timestamp and truncation.

### `writeTraceHtml(tree, options)`

Renders HTML and writes it through the injected `fs`. Defaults to `os.tmpdir()/poe-code-traces/trace-<id>.html` when `outPath` is omitted.

### `openTraceHtml(tree, options)`

Writes HTML then opens it via `openExternal` (injectable through `options.open`) using a `file:` URL.

### `detectTraceFile(firstLine)`

Detects the trace source from the first JSONL line:

- Object with an `event` key: `poe-code`
- `type` of `session_meta`, `response_item`, or `event_msg`: `codex`
- `sessionId` key or `type` of `user`, `assistant`, or `system`: `claude`

### `loadTraceFromFile(path, options)`

Reads the first line of a JSONL file, detects the source, builds a minimal trace reference, and delegates to `loadTrace`.

## Environment Variables

This package exposes no environment variables.

## Configuration

This package exposes no package-level configuration options.
