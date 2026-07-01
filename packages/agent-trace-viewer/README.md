# @poe-code/agent-trace-viewer

Non-UI core for listing, loading, and summarizing normalized agent traces.

The package builds on `@poe-code/agent-traces` readers and exposes the SDK surface that future CLI and UI layers should consume directly.

## CLI Usage

The poe-code CLI wires this package as `poe-code traces`.

```sh
poe-code traces [path] [--source claude codex poe-code] [--all-workspaces] [--since 30d] [--limit 50] [--json] [--yes]
```

- `path`: Load a specific JSONL trace file and render its detail view.
- `--source <sources...>`: Restrict discovery to `claude`, `codex`, and/or `poe-code`.
- `--all-workspaces`: Disable the current-workspace filter for sources that support workspace filtering.
- `--since <duration>`: Include only traces updated within a duration such as `30d`, `12h`, or `45m`.
- `--limit <n>`: Maximum discovered trace references to list. Defaults to `50`.
- `--json`: Emit machine-readable JSON. List mode emits trace references; path mode emits the loaded `TraceView` plus `subagents`.
- `--yes`: Skip the interactive explorer and print the trace list table.

Without `--yes`, `--json`, or a non-TTY stdin, list mode opens the interactive explorer. `Enter` opens the selected trace detail, `s` drills into available subagent traces, `c` prints the trace path, and `r` refreshes discovery.

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

Context usage uses reported trace usage when available. Otherwise it estimates tokens from logged turn text with `tokenfill`.

### `computeContextBreakdown(trace)`

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

The breakdown is an estimate from logged content using `tokenfill` with `cl100k`. Tool definitions are not present in any trace format, so it measures skill payloads, MCP/tool call inputs and outputs, reminders, and messages, not the schema block. For poe-code traces content is redacted, so its breakdown shows call counts with near-zero tokens; that is expected, not a bug.

### `loadSubagentSummaries(view, options)`

Loads child trace references from `view.children` and returns one summary per successfully loaded child.

Each child has its own context window. Child tokens are never added to the parent gauge or breakdown; the parent already pays for the child's returned tool result, which the breakdown counts under Tools.

### `detectTraceFile(firstLine)`

Detects the trace source from the first JSONL line:

- Object with an `event` key: `poe-code`
- `type` of `session_meta`, `response_item`, or `event_msg`: `codex`
- `sessionId` key or `type` of `user`, `assistant`, or `system`: `claude`

### `loadTraceFromFile(path, options)`

Reads the first line of a JSONL file, detects the source, builds a minimal trace reference, and delegates to `loadTrace`.

## Configuration

This package does not introduce any new config keys or environment variables.
