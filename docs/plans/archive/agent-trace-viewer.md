---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: agent-traces-usage-fields
    title: Extract token usage in claude and codex trace readers
    prompt: >
      In packages/agent-traces, extend the trace model and the two existing

      readers so a normalized trace carries reported token usage and model

      info. Do NOT create a new package; extend the existing one.


      1. In packages/agent-traces/src/types.ts add to `NormalizedTrace`:
         - `model?: string`
         - `contextWindow?: number` (only when the source reports it)
         - `usage?: TraceUsage` where `TraceUsage` is a new exported interface:
           `{ inputTokens: number; outputTokens: number; cachedTokens?: number;
              cacheCreationTokens?: number; contextTokens: number;
              source: "reported" }`
           `contextTokens` is the current context length: the token footprint
           of the most recent request in the session.

      2. Claude reader (packages/agent-traces/src/readers/claude.ts).
         Claude Code transcripts live at `~/.claude/projects/<encoded-cwd>/*.jsonl`.
         Records with `type === "assistant"` carry `message.usage` and
         `message.model`. Verified real record shape:
         `{ "type": "assistant", "message": { "model": "claude-fable-5",
            "usage": { "input_tokens": 4223, "cache_creation_input_tokens": 7564,
            "cache_read_input_tokens": 15103, "output_tokens": 247 } } }`
         While reading turns (the existing loop in `readTrace`), also track the
         LAST record that has `message.usage`. From it set:
         - `model` = `message.model`
         - `usage.inputTokens` = `input_tokens`
         - `usage.outputTokens` = `output_tokens`
         - `usage.cachedTokens` = `cache_read_input_tokens`
         - `usage.cacheCreationTokens` = `cache_creation_input_tokens`
         - `usage.contextTokens` = input_tokens + cache_read_input_tokens
           + cache_creation_input_tokens + output_tokens
         Treat every field as possibly missing; skip usage entirely if no
         assistant record has a usage object.

      3. Codex reader (packages/agent-traces/src/readers/codex.ts).
         Rollout JSONL files (path comes from the sqlite `threads.rollout_path`
         column, files live under `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`)
         contain records `{ "type": "event_msg", "payload": { "type":
         "token_count", "info": { "total_token_usage": {...}, "last_token_usage":
         { "input_tokens": 33693, "cached_input_tokens": 4992, "output_tokens":
         390, "reasoning_output_tokens": 170, "total_tokens": 34083 },
         "model_context_window": 258400 } } }`.
         In `readRollout`, track the LAST `token_count` payload and set:
         - `usage.inputTokens` = `last_token_usage.input_tokens`
         - `usage.outputTokens` = `last_token_usage.output_tokens`
         - `usage.cachedTokens` = `last_token_usage.cached_input_tokens`
         - `usage.contextTokens` = `last_token_usage.total_tokens`
         - `contextWindow` = `info.model_context_window`
         The sqlite `threads` table has a `model` column the reader already
         maps; pass it through to `trace.model`.
         All fields optional; omit `usage` when no token_count event exists.

      4. Export `TraceUsage` from packages/agent-traces/src/index.ts.


      TDD: write vitest tests first, colocated as src/readers/*.test.ts,

      using the injected `AgentTraceFileSystem` / sqlite factory fakes the

      existing tests already use (never touch real disk). Cover: usage

      present, usage absent, multiple usage records (last one wins),

      malformed usage values ignored.

      Update packages/agent-traces/README.md to document the new fields.
    status:
      implement: done
      test: done
  - id: agent-traces-structured-turns
    title: Emit structured turns (tools, MCP, skills, system) from readers
    prompt: |
      In packages/agent-traces, enrich `NormalizedTraceTurn` so downstream
      consumers can attribute context to skills, MCP servers, and individual
      tools WITHOUT knowing anything about the underlying formats. All format
      knowledge stays inside each reader.

      1. In src/types.ts extend `NormalizedTraceTurn` with optional fields:
         - `toolName?: string`
         - `mcpServer?: string`
         - `skillName?: string`
         `sourceKind` (already exists) gains these conventional values:
         "reasoning", "tool_use", "tool_result", "skill_instructions",
         "system_reminder", "base_instructions". Document each in the README.

      2. Claude reader (src/readers/claude.ts). Today it merges message
         content into one text per record; change it to emit one turn PER
         CONTENT BLOCK for array content (string content stays one turn).
         Verified real shapes to handle:
         - assistant `text` block -> role "assistant".
         - assistant `thinking` block -> role "assistant",
           sourceKind "reasoning", text from the block's thinking field.
         - assistant `tool_use` block
           (`{ "type": "tool_use", "name": "Bash", "input": {...} }`)
           -> role "tool", sourceKind "tool_use", toolName = name,
           text = JSON.stringify(input). When name starts with `mcp__`,
           set mcpServer = name.split("__")[1]. When name === "Skill",
           remember `input.skill` as the pending skill name for this file.
         - user `tool_result` block
           (`{ "type": "tool_result", "tool_use_id": "...", "content": ... }`)
           -> role "tool", sourceKind "tool_result", text = the stringified
           content (reuse the existing content-flattening helper). Maintain a
           tool_use_id -> {toolName, mcpServer} map while scanning so results
           inherit toolName/mcpServer from their call.
         - user `text` block whose text starts with
           `Base directory for this skill:` -> role "system",
           sourceKind "skill_instructions", skillName = the pending skill
           name recorded from the preceding Skill tool_use (verified real
           sequence: Skill tool_use -> tool_result "Launching skill: X" ->
           user text "Base directory for this skill: ..."). If no pending
           name, parse the skill name from the first line's path segment
           after `/skills/` using string splitting (no regexes).
         - user `text` block containing `<system-reminder>` -> role "system",
           sourceKind "system_reminder".
         - any other user text -> role "human" (unchanged).
         CRITICAL invariant: `collectHumanPrompts` filters turns with role
         "human" — skill instructions, system reminders, and tool turns must
         NOT get role "human", or gaslight's prompt extraction regresses.
         Add a test that runs collectHumanPrompts over a fixture containing
         all block kinds and asserts only genuine human prompts come back.

      3. Codex reader (src/readers/codex.ts). Extend `turnFromRolloutRecord`
         (currently only handles message/user_message) for these verified
         payload types:
         - `session_meta` with `payload.base_instructions.text` -> role
           "system", sourceKind "base_instructions", text = that string
           (this is the full Codex system prompt — it IS in the rollout).
         - `reasoning` -> role "assistant", sourceKind "reasoning".
         - `agent_message` -> role "assistant" (likely already works; keep).
         - `function_call` (`{ "name": "exec_command", "arguments":
           "<json-string>", "id"/"call_id": ... }`) -> role "tool",
           sourceKind "tool_use", toolName = name, text = arguments.
           Maintain call_id -> name map.
         - `function_call_output` (`{ "call_id": ..., "output": "<string>" }`)
           -> role "tool", sourceKind "tool_result", toolName from the map,
           text = output.
         - `custom_tool_call` / `custom_tool_call_output` -> same treatment
           as function_call / function_call_output.
         - `mcp_tool_call_end` (`{ "invocation": { "server": "pdf", "tool":
           "read_pdf", "arguments": {...} }, "result": { "Ok": { "content":
           [{ "type": "text", "text": "..." }] } } }`) -> role "tool",
           sourceKind "tool_result", toolName = invocation.tool,
           mcpServer = invocation.server, text = stringified arguments plus
           the concatenated result content texts.
         Unknown payload types keep being skipped. Same collectHumanPrompts
         invariant and test as for claude.

      4. Turn ordering must remain file order. Keep existing exported
         behavior/tests green; extend fixtures rather than rewriting them.

      TDD with the existing injected-fs fixture pattern. Build fixtures as
      inline JSONL strings copying the verified shapes above. Update
      packages/agent-traces/README.md (new turn fields, sourceKind values).
    status:
      implement: done
      refactor: done
      test: done
  - id: agent-traces-subagent-children
    title: Discover nested subagent traces in the claude reader
    prompt: >
      In packages/agent-traces, make the claude reader surface subagent

      (Task/Agent tool) transcripts as child traces, so a viewer can drill

      from a session into the agents it spawned. Verified on-disk layout

      (real files):

      - Parent session: `~/.claude/projects/<enc-cwd>/<sessionId>.jsonl`

      - Subagent transcripts: sibling directory
        `~/.claude/projects/<enc-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl`
        — full JSONL transcripts in the same record format as the parent
        (they have `message.usage` records too, so context extraction from
        the earlier task works on them unchanged). Their records carry
        `"isSidechain": true` and `"agentId": "<id>"`.
      - Sidecar metadata per subagent:
        `agent-<agentId>.meta.json` with exactly
        `{ "agentType": "Explore", "description": "Research trace formats",
           "toolUseId": "toolu_01Kbq...", "spawnDepth": 1 }`
        `toolUseId` matches the `id` of the `tool_use` block (name "Agent"
        or "Task") in the transcript that spawned it — in the PARENT's
        transcript for depth 1, in another SUBAGENT's transcript for
        depth 2+.

      1. In src/types.ts:
         - Add to `TraceReference`: `agentType?: string`,
           `spawnDepth?: number` (`title` carries the description).
         - Add to `NormalizedTrace`: `children?: TraceReference[]`.
      2. In src/readers/claude.ts `readTrace`: while scanning records,
         collect the ids of all `tool_use` blocks named "Agent" or "Task".
         After reading, list `<transcript-dir-resolved-to-the-session
         directory>/subagents/` (for a parent at `<dir>/<sessionId>.jsonl`
         the subagents dir is `<dir>/<sessionId>/subagents`; for a subagent
         at `<dir>/<sessionId>/subagents/agent-x.jsonl` it is its own
         directory). For every `agent-*.meta.json` whose `toolUseId` is in
         the collected set, emit a child `TraceReference`:
         `{ source: "claude", id: agentId, path: <the agent-<id>.jsonl>,
            title: meta.description, agentType: meta.agentType,
            spawnDepth: meta.spawnDepth, cwd/updatedAt as available }`.
         Matching by toolUseId is what makes nesting recursive: reading a
         child trace attaches ITS children the same way with zero extra
         logic. Missing/unparsable meta.json -> skip that child silently.
         No subagents directory -> `children` stays undefined.
      3. `discover` must keep listing ONLY top-level session files — verify
         the existing listing does not recurse into the `<sessionId>/`
         subdirectories and add a test pinning that.
      4. Codex and poe-code have no parent/child linkage in their formats
         (verified) — their readers are untouched; `children` simply stays
         undefined for them.

      TDD with the injected-fs fixture pattern: fixture with a parent

      transcript (two Agent tool_use blocks), a subagents dir with two

      matching children + one orphan (toolUseId not in the parent — must be

      excluded), a nested depth-2 child hanging off a subagent's own

      tool_use, and a broken meta.json. Assert children ordering follows

      tool_use order in the transcript. Update the README.
    status:
      implement: done
      test: done
  - id: agent-traces-poe-code-reader
    title: Add poe-code spawn-log reader to agent-traces
    prompt: >
      In packages/agent-traces, add a third trace reader for poe-code's own

      spawn logs, following the exact same `TraceReader` interface as

      packages/agent-traces/src/readers/claude.ts and codex.ts. No if/case

      branching on source anywhere outside the reader itself — consumers must

      keep iterating the `traceReaders` array.


      Format facts (verified against real files):

      - Location: `~/.poe-code/spawn-logs/*.jsonl`

      - Filename: `<YYYYMMDD>-<HHMMSS>-<mmm>-<agent>-<sessionId>.jsonl`,
        e.g. `20260701-192947-526-codex-b65c65af-8890-4034-be7c-d4caa92346c4.jsonl`
      - JSONL events, one per line, all with optional `_meta` (may carry
        `ts`, epoch milliseconds):
        - `{ "event": "session_start", "threadId"?: string }`
        - `{ "event": "agent_message", "text": string }`
        - `{ "event": "reasoning", "text": string }`
        - `{ "event": "tool_start", "kind": string, "title": string, "id"?: string }`
        - `{ "event": "tool_complete", "kind": string, "path": string, "id"?: string }`
        - `{ "event": "usage", "inputTokens": number, "outputTokens": number,
            "cachedTokens"?: number, "cacheCreationTokens"?: number }`
        - `{ "event": "spawn_result", "exitCode": number, "usage"?: {...same} }`
        - `{ "event": "error", "message": string }`
        NOTE: tool titles/paths may be the literal string "[redacted]" —
        the spawn-log middleware redacts content by default (see
        packages/agent-spawn/src/acp/middlewares/spawn-log.ts; read it to
        confirm shapes before implementing). The reader must pass these
        through as-is; token attribution for poe-code traces is therefore
        call-count based, not content based — that is expected.

      Implementation (packages/agent-traces/src/readers/poe-code.ts):

      1. Add `"poe-code"` to the `AgentTraceSource` union in src/types.ts.

      2. `defaultRoots(homeDir)` returns `[join(homeDir, ".poe-code",
      "spawn-logs")]`.

      3. `discover(options)`: readdir the root, keep `*.jsonl`, parse the
         filename (string splitting on "-", no regexes) into timestamp,
         agent, sessionId. Build `TraceReference` with `source: "poe-code"`,
         `id` = sessionId, `path`, `updatedAt` from `fs.stat` mtime (fall
         back to the filename timestamp), `title` = agent name, no `cwd`
         (spawn logs do not record one, so they are always included
         regardless of the cwd filter). Respect `since` via `updatedAt`.
      4. `read(reference, options)`: parse lines defensively (skip
         unparsable lines). Map to `NormalizedTraceTurn`:
         - `agent_message` -> role "assistant"
         - `reasoning` -> role "assistant", sourceKind "reasoning"
         - `tool_start` -> role "tool", sourceKind "tool_use",
           toolName = kind, text = title
         - `tool_complete` -> role "tool", sourceKind "tool_result",
           toolName = kind, text = path
         - `error` -> role "system", text = message
         Timestamps from `_meta.ts` when present.
         Usage: track the LAST `usage` event (fall back to
         `spawn_result.usage`); map inputTokens/outputTokens/cachedTokens/
         cacheCreationTokens directly (already camelCase) and set
         `usage.contextTokens` = inputTokens + outputTokens (cachedTokens is
         a subset of inputTokens — never add it again). Set `model` = the
         agent name from the filename.
      5. Export `poeCodeTraceReader` from src/index.ts and append it to the
         `traceReaders` array.

      TDD first, same injected-fs test pattern as the other reader tests.

      Cover: filename parsing, since filter, turn mapping incl. redacted

      titles, usage from last usage event, fallback to spawn_result, file

      with only session_start + error (real case — must not crash, no

      usage). Document the reader in packages/agent-traces/README.md.
    status:
      implement: done
      test: done
  - id: agent-trace-viewer-core
    title: Create @poe-code/agent-trace-viewer package with SDK core
    prompt: |
      Create a new workspace package `packages/agent-trace-viewer` named
      `@poe-code/agent-trace-viewer` (private: true) containing the non-UI
      core of a trace viewer. Copy the package.json / tsconfig.json shape
      from packages/plan-browser verbatim (build via
      ../../scripts/guard-package-dist.mjs && tsc, vitest-from-root test
      script, `"files": ["dist"]`, ESM, exports map). Dependencies:
      `"@poe-code/agent-traces": "*"`, `"tokenfill": "*"`,
      `"toolcraft-design": "*"`. tiktoken is already a root dependency so
      this adds no new externals to the bundle.

      Public API (src/index.ts) — this IS the SDK surface; the CLI command
      added later must consume only these:

      1. `listTraces(options: ListTracesOptions): Promise<TraceReference[]>`
         - options: `{ cwd: string; homeDir: string; fs: AgentTraceFileSystem;
           sources?: AgentTraceSource[]; allWorkspaces?: boolean;
           since?: Date; limit?: number; sqlite?: SqliteTraceDatabaseFactory }`
         - Iterates `traceReaders` from @poe-code/agent-traces (filtered by
           `sources` when given), calls `discover`, merges, sorts by
           `updatedAt` descending, applies `limit` (default 50). A reader
           that throws (e.g. missing ~/.codex sqlite) is skipped silently.

      2. `loadTrace(reference, options): Promise<TraceView>`
         - Finds the reader by `reader.id === reference.source` from the
           array (no switch statements), calls `read`.
         - `TraceView` = `NormalizedTrace` + `context: ContextUsage` +
           `breakdown: ContextBreakdown`.
         - `ContextUsage` = `{ tokens: number; window: number;
           percent: number; source: "reported" | "estimated" }`.
           tokens: `usage.contextTokens` when the trace has usage
           ("reported"), else `countTokens` from tokenfill over all turn
           texts joined with "\n" ("estimated").
           window: `trace.contextWindow` when present (codex reports it),
           else look up `CONTEXT_WINDOWS` in src/context.ts — an array of
           `{ match: string; window: number }` checked with
           `model.startsWith(match)`, seeded with
           `{ match: "claude", window: 200000 }` — falling back to
           `DEFAULT_CONTEXT_WINDOW = 200000`. No regexes.

      3. `computeContextBreakdown(trace: NormalizedTrace): ContextBreakdown`
         — the headline feature: attribute estimated tokens to what fills
         the context (skills, MCP, tools, prompts). Pure function over
         normalized turns; zero knowledge of claude/codex/poe-code formats.
         Implementation: a declarative ordered matcher list in
         src/breakdown.ts — first match wins per turn:
           1. "System prompt"    -> turn.sourceKind === "base_instructions"
           2. "Skills"           -> turn.skillName set; group items by skillName
           3. "MCP"              -> turn.mcpServer set; group items by mcpServer
           4. "System reminders" -> turn.sourceKind === "system_reminder"
           5. "Tools"            -> turn.role === "tool"; group items by
                                    toolName ?? "unknown"
           6. "Reasoning"        -> turn.sourceKind === "reasoning"
           7. "Messages"         -> role "human" or "assistant"
           8. "Other"            -> everything else
         Per turn, tokens = `countTokens(turn.text)`. Result shape:
         `{ measuredTokens: number; categories: Array<{ id: string;
            label: string; tokens: number; percent: number;
            items: Array<{ name: string; tokens: number; count: number }> }> }`
         - percent = share of measuredTokens (integer, rounded).
         - items sorted by tokens descending; categories keep the fixed
           order above; categories with 0 tokens are omitted.
         - count = number of turns attributed to that item.
         Note in the README: the breakdown is an estimate from logged
         content (tokenfill/cl100k); tool DEFINITIONS are not present in any
         trace format, so it measures skill payloads, MCP/tool call inputs
         and outputs, reminders, and messages — not the schema block. For
         poe-code traces content is redacted, so its breakdown shows call
         counts with near-zero tokens; that is expected, not a bug.

      4. Subagents: `TraceView` inherits `children?: TraceReference[]` from
         `NormalizedTrace` (the claude reader populates it; codex/poe-code
         leave it undefined). Children are loaded lazily — a child reference
         has a `path` and `source`, so `loadTrace(child, options)` just
         works. Add `loadSubagentSummaries(view, options):
         Promise<SubagentSummary[]>` where `SubagentSummary` =
         `{ reference: TraceReference; context: ContextUsage;
            turnCount: number }` — it loads each child and computes its own
         ContextUsage (each subagent is its own context window; child
         tokens are NEVER added into the parent's gauge or breakdown — the
         parent already pays for the child's returned tool_result, which the
         breakdown counts under Tools). A child that fails to load is
         skipped silently.

      5. `detectTraceFile(firstLine: string): AgentTraceSource | undefined`
         — parse the first JSONL line: object with an `event` key ->
         "poe-code"; `type` of "session_meta"/"response_item"/"event_msg" ->
         "codex"; `sessionId` key or `type` of "user"/"assistant"/"system"
         -> "claude"; else undefined.

      6. `loadTraceFromFile(path, options): Promise<TraceView>` — read the
         first line, detect the source, build a minimal TraceReference
         (`{ source, id: path, path }`), delegate to `loadTrace`.

      TDD with vitest, colocated tests, injected in-memory fs fakes (same
      pattern as agent-traces tests; never real disk). Mock countTokens
      where exact numbers would be brittle. Cover: sorting + limit, source
      filter, reader error skipped, reported vs estimated context, window
      from codex vs map vs default, detectTraceFile for all three formats
      plus garbage, and breakdown: skill grouping, MCP grouping by server,
      per-tool items, first-match-wins precedence (an MCP turn must land in
      MCP, not Tools), zero-token categories omitted, empty trace. Subagent
      coverage: loadSubagentSummaries over a view with two children (one
      with reported usage, one estimated), a failing child skipped, a view
      with no children returns [], and an assertion that parent context
      tokens are unaffected by children.

      Write packages/agent-trace-viewer/README.md: what it does, public API,
      the breakdown-estimate caveat above, and "This package does not
      introduce any new config keys or environment variables" (or document
      them if any are added).
    status:
      implement: done
      test: done
  - id: agent-trace-viewer-tui
    title: Interactive trace explorer UI with context gauge and breakdown
    prompt: >
      In the existing packages/agent-trace-viewer package, add the

      presentation layer. Use ONLY toolcraft-design primitives — no chalk,

      no @clack/prompts, no ink. Study packages/plan-browser/src for the

      canonical explorer usage before writing code.


      1. src/render.ts — pure string-returning renderers (unit-testable):
         - `renderContextGauge(context: ContextUsage, width?: number): string`
           One slick line:
           `▐████████░░░░░░░░▌ 34.1k / 258.4k · 13% · reported`
           Fill proportional to percent, clamped at 100% (still print the
           real percent). Tone via toolcraft-design theme colors: success
           below 60%, warning 60–84%, danger 85%+. Dim "(estimated)" suffix
           when source is "estimated". Format counts as `4.2k` above 1000,
           `1.2M` above 1e6, plain below.
         - `renderBreakdown(breakdown: ContextBreakdown, width?: number): string`
           The star of the detail view, modeled on Claude Code's /context:
           a segmented horizontal bar (one colored segment per category,
           consistent category->color from a single declarative map), then
           one row per category sorted by the fixed category order:
           `  ■ Skills          18.2k  12%`
           and nested item rows for Skills / MCP / Tools (top 5 items each,
           then `… n more`):
           `      poe-code-pipeline-plan   9.1k  ×2`
           Right-align token columns; dim the ×count.
         - `renderTraceLine(item: TraceReference): { label, meta }` — label
           is title (or id) truncated; meta shows a source badge (claude /
           codex / poe-code, colored from one declarative map), relative
           time ("2h ago"), and cwd basename when present.
         - `renderSubagents(summaries: SubagentSummary[]): string` — a
           "Subagents" section: one row per child with a tree glyph, agent
           type badge, description, compact context gauge, and turn count:
           `  ├─ Explore  Research trace formats   ▐███░░▌ 26.6k · 13%  57 turns`
           Depth 2+ children (spawnDepth from the reference) get deeper
           indentation. Empty input renders nothing.
         - `renderTraceDetail(view: TraceView, subagents?: SubagentSummary[]): string`
           — header block: title, source badge, model, turn count,
           started/updated, the context gauge, then the breakdown panel,
           then the Subagents section when present, then the conversation:
           each turn prefixed by a role glyph (human ›, assistant ✦, tool ⚙,
           system ⚠) with role-toned color; tool and system turns collapsed
           to a few lines with a dim `… +n lines` suffix; assistant text
           through the toolcraft-design markdown renderer.

      2. src/run.ts — `runTraceViewer(options): Promise<void>`:
         - options: `{ cwd, homeDir, fs, assumeYes?, sources?,
           allWorkspaces?, since?, limit?, json?, path?, output? }` where
           `output` is a writable defaulting to process.stdout (so tests
           never print).
         - `path` set: `loadTraceFromFile`, then `loadSubagentSummaries`
           when the view has children, print `renderTraceDetail` (or, when
           `json`, JSON.stringify of the TraceView plus a `subagents` array
           of the summaries — dates as ISO).
         - Non-interactive (`assumeYes || process.stdin.isTTY !== true ||
           json`): print the list — with `json` a JSON array of
           TraceReference; otherwise a toolcraft-design `renderTable` with
           columns Source, Title, Updated, Cwd. Empty state: friendly
           one-liner "No traces found", exit 0.
         - Interactive: `runExplorer` (or `runTwoPaneExplorer` if it fits
           better after reading plan-browser) with rows from `listTraces`;
           detail pane lazily calls `loadTrace` + `loadSubagentSummaries`
           (can exceed 700ms — show a toolcraft-design spinner while
           loading) and shows `renderTraceDetail`. Actions: Enter opens
           detail; `s` on a trace with subagents opens a nested explorer of
           its children (rows from the child references, detail pane =
           `renderTraceDetail` of the loaded child — recursion gives
           depth 2+ for free; hide or disable the action when there are no
           children); `c` prints the trace file path; `r` refreshes. Keep
           actions minimal (YAGNI).

      3. Export `runTraceViewer` and the render functions from src/index.ts.


      TDD: unit-test renderers with fixed inputs (strip ANSI or snapshot

      with ANSI — follow whatever plan-browser render tests do). Gauge edge

      cases: 0 tokens, percent > 100, tiny width, estimated label.

      Breakdown edge cases: single category, item overflow (`… n more`),

      empty breakdown, redacted poe-code trace (counts, ~0 tokens).

      Subagent renderer cases: empty list renders nothing, depth

      indentation, long description truncation. Test the non-interactive

      branch via the injected `output` writable. Do NOT write tests driving

      the interactive explorer loop.
    status:
      implement: done
      refactor: done
      test: done
  - id: traces-cli-command
    title: Register poe-code traces command
    prompt: |
      Wire the trace viewer into the poe-code CLI as `poe-code traces`.
      There is no existing traces/trace command (verify with a quick grep of
      src/cli before starting; gaslight only mentions traces in prose).

      1. Create src/cli/commands/traces.ts exporting
         `registerTracesCommand(program: Command, container: CliContainer)`.
         Follow the structure of src/cli/commands/plan.ts (imports,
         `resolveCommandFlags`, container usage). Command definition:
         - `traces [path]` — description "Browse claude, codex and poe-code
           agent traces with context usage and breakdown."
         - `--source <sources...>` (variadic: claude, codex, poe-code) —
           validate against the AgentTraceSource union, clear error on
           unknown values
         - `--all-workspaces` — traces from every workspace, not just cwd
         - `--since <duration>` — parsed with the `parse-duration` package
           already in root deps (same pattern as gaslight's --since)
         - `--limit <n>` — max traces listed, default 50
         - `--json` — machine-readable output, implies non-interactive
         - Action: `intro("traces")` unless --json; then call
           `runTraceViewer` from `@poe-code/agent-trace-viewer` passing
           `cwd: container.env.cwd`, `homeDir: container.env.homeDir`,
           `fs: container.fs`, `assumeYes: flags.assumeYes`, and the parsed
           options. The command file owns only flag parsing/validation and
           intro; all behavior lives in the package.
      2. Register in src/cli/program.ts inside bootstrapProgram, next to the
         other register* calls, consistent with neighbors.
      3. Root package.json: add `"@poe-code/agent-trace-viewer": "*"` where
         the other workspace packages are declared and add
         `"packages/agent-trace-viewer/dist"` to the `files` array (mirror
         exactly how plan-browser is wired).
      4. CLI/SDK parity: every flag maps 1:1 onto `runTraceViewer` options.
      5. Verify: `npm run build`, then spot-test all paths:
         `npm run dev -- traces --yes` (table), `npm run dev -- traces --json
         | head`, `npm run dev -- traces --source poe-code --yes`,
         `npm run dev -- traces <some ~/.claude/projects .jsonl file> --yes`
         (must show gauge + breakdown with a Skills row if the transcript
         used skills, and a Subagents section with per-child gauges if the
         session spawned Agent/Task subagents — pick a session whose
         `<sessionId>/subagents/` directory exists), and
         `npm run dev -- traces --help`. Confirm the
         bundle build succeeds and adds no new external deps.

      Write a unit test for the command registration following whatever
      pattern existing src/cli command tests use (flag parsing + delegation
      with a stubbed runTraceViewer); no real subprocesses in tests.
    status:
      implement: done
      test: done
  - id: traces-visual-qa
    title: Screenshot QA and polish for traces command
    prompt: |
      Visually validate and polish the `poe-code traces` command using
      screenshots (mandatory for visual CLI changes; do not write screenshot
      tests — screenshots are ad-hoc validation only).

      1. Run and inspect each of:
         - `npm run screenshot-poe-code -- traces --yes`
         - `npm run screenshot-poe-code -- traces` (interactive explorer)
         - `npm run screenshot-poe-code -- traces <real ~/.claude/projects
           jsonl that used skills, MCP tools, and spawned subagents> --yes`
           (detail view — this is the money shot: gauge + breakdown with
           Skills, MCP, Tools rows + the Subagents tree with per-child
           gauges; sessions with a `<sessionId>/subagents/` directory next
           to the jsonl qualify)
         - `npm run screenshot-poe-code -- traces --help`
         Open every produced PNG and LOOK at it.
      2. Acceptance criteria — fix whatever fails:
         - List aligned at 80 columns, no wrap/overflow; long titles and
           cwds truncated with an ellipsis.
         - Breakdown bar segments sum to full width; category colors match
           their row markers; token columns right-aligned; per-skill and
           per-MCP-server item rows show real names (e.g. a skill name like
           poe-code-pipeline-plan, an MCP server like terminal-pilot-mcp).
         - Gauge proportions and tone correct (hand-write a poe-code spawn
           log jsonl into ~/.poe-code/spawn-logs/ near a window limit to see
           the danger tone; delete it afterwards).
         - Source badges use one consistent color per source everywhere.
         - Empty state (temp HOME or unmatched --source) prints the friendly
           message, no stack trace.
         - A claude trace shows model + "reported" gauge; a trace without
           usage records shows "(estimated)".
         - The Subagents tree renders aligned rows with per-child gauges;
           in the interactive explorer `s` drills into a child and its
           detail view renders correctly (subagent transcripts share the
           parent record format, so gauge + breakdown must work there too).
         - A redacted poe-code trace shows tool call counts without garbage.
         - `--json` output parses (pipe through node JSON.parse).
      3. Fix visual defects, re-screenshot until clean.
      4. Confirm packages/agent-trace-viewer/README.md and
         packages/agent-traces/README.md are accurate (flags, API, the
         breakdown-estimate caveat). Do not touch the root README.
    status:
      implement: done
name: agent-trace-viewer
state: archived
---

# Context

## Goal

A slick interactive CLI trace viewer, `poe-code traces`, that browses agent
sessions from three sources, shows each session's current context length as
a colored gauge, breaks the context down by what fills it — skills loaded,
MCP servers/tools, individual tool calls, system prompt, system reminders,
reasoning, messages — and lets you drill into nested subagent traces, each
with its own gauge and breakdown. Shipped as a new workspace package
`@poe-code/agent-trace-viewer`; no new third-party deps (tiktoken already
ships via tokenfill).

## Validated format facts (checked against real files on 2026-07-01)

| Source | Location | Context length | Attribution data |
|---|---|---|---|
| claude | `~/.claude/projects/<enc-cwd>/*.jsonl` | last assistant `message.usage`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens + output_tokens`; model in `message.model` | `tool_use` blocks with names (`mcp__<server>__<tool>` for MCP); `Skill` tool_use with `input.skill`, followed by a user text turn starting `Base directory for this skill:` carrying the skill payload; `<system-reminder>` text blocks |
| codex | `~/.codex/state_5.sqlite` (threads) + `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | last `token_count` event: `info.last_token_usage.total_tokens`; window reported in `info.model_context_window` (258400 observed) | `function_call`/`function_call_output` with names and payloads; `mcp_tool_call_end` with `invocation.server`/`invocation.tool` and result content; full system prompt in `session_meta.base_instructions.text`; `reasoning` payloads |
| poe-code | `~/.poe-code/spawn-logs/<ts>-<agent>-<session>.jsonl` | last `{"event":"usage"}`: `inputTokens + outputTokens` (`cachedTokens` is a subset of input) | `tool_start`/`tool_complete` with `kind`; content is `[redacted]` by the spawn-log middleware, so attribution is call-count based |

Subagent nesting (verified against this repo's own sessions): Claude stores
each spawned agent's full transcript at
`~/.claude/projects/<enc-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl`
(same record format as the parent, `isSidechain: true`, own usage records)
with a sidecar `agent-<agentId>.meta.json` of
`{ agentType, description, toolUseId, spawnDepth }`; `toolUseId` matches the
spawning `Agent`/`Task` tool_use block, which makes parent→child matching
recursive for depth 2+. Codex rollouts and poe-code spawn logs carry no
parent/child linkage — nesting is claude-only until those formats record
one.

Tool DEFINITIONS (the schema block sent with each request) are absent from
every format — the breakdown measures logged content (skill payloads, tool
inputs/outputs, reminders, messages) via exact tiktoken counts from
`tokenfill`, and is labeled an estimate. Reported usage is used for the
total gauge whenever present.

## Design decisions

- All format knowledge lives in `@poe-code/agent-traces` readers.
  `NormalizedTraceTurn` gains `toolName` / `mcpServer` / `skillName` and
  richer `sourceKind` values; the viewer computes the breakdown from
  normalized turns through a declarative first-match-wins category list —
  zero per-source branching outside readers.
- `collectHumanPrompts` invariant: new turn kinds (skill payloads,
  reminders, tools) never get role "human", so gaslight's prompt extraction
  is unaffected — guarded by tests.
- Context windows: codex reports its own; otherwise a declarative prefix
  map (`claude` → 200000) with a 200000 default. No regexes anywhere.
- UI built exclusively on `toolcraft-design` (`runExplorer`, `renderTable`,
  theme colors); `plan-browser` is the reference implementation.
- Non-interactive parity: `--yes`/non-TTY prints a table, `--json` prints
  machine-readable output, an explicit file path renders one trace with
  gauge + breakdown — every interactive capability reachable via args.
- Subagents are separate contexts: child references hang off
  `NormalizedTrace.children` and load lazily through the same reader path;
  a child's tokens are never added to the parent's gauge or breakdown (the
  parent already pays for the child's tool_result, counted under Tools).
- SDK parity: the package exports `listTraces`, `loadTrace`,
  `loadTraceFromFile`, `computeContextBreakdown`, `loadSubagentSummaries`,
  `runTraceViewer`; the CLI command only parses flags and delegates.
