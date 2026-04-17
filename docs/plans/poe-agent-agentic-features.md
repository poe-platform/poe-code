---
kind: superintendent
version: 1

builder:
  agent: claude-code
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  code-quality:
    agent: claude-code
    prompt: |
      Review builder changes in @poe-code/poe-agent for convention, SOLID, and KISS. Flag over-engineering and plugins that duplicate existing ones.

      Make sure we follow the modular pattern, everything is a plugin beyond the few primitives

  claude-code-reference:
    agent: claude-code
    cwd: /Users/kjopek/Workspace/claude-code-leak
    prompt: |
      Investigate how Claude Code implements agentic features (tool loop, compaction, planning, memory, skills, MCP, spawn) and call out gaps vs what the builder just landed.

  goose-reference:
    agent: claude-code
    prompt: |
      Fetch https://github.com/aaif-goose/goose and summarise how goose implements agentic features. Flag anything material the builder's output is missing.

  testing:
    agent: claude-code
    prompt: |
      Verify tests exist for the builder's changes and that the full @poe-code/poe-agent test suite passes.

superintendent:
  agent: claude-code
  prompt: |
    Review builder and inspector output, update the Task Board in {{plan.path}}, and drive rework only for real gaps that make the agent less solid. Reject scope creep. Request owner review when the board is complete.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Code quality
    {{inspectors.code-quality}}

    ## Testing
    {{inspectors.testing}}

owner:
  agent: claude-code
  prompt: |
    Decide if poe-agent now has the agentic features a user would expect, without being overbuilt. Approve or send back with specific feedback.

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 100

status:
  state: in_progress
  round: 1
  review_turn: 0
---

# poe-agent Agentic Features

## Summary

Close the real gaps between `@poe-code/poe-agent` and reference agents (Claude Code, goose): stronger file/shell tools, web fetch, context compaction, `AGENTS.md` memory, a policy system matching `@poe-code/agent-spawn` modes (`read | edit | yolo`), a fully-fledged hook surface, and multimodal tool results. Every feature lands as a plugin — the core stays minimal.

## 1. Problem

### What hurts today

`@poe-code/poe-agent` has a plugin runtime ([packages/poe-agent/src/plugins](packages/poe-agent/src/plugins)) with files, shell, web, spawn, skills, scratchpad, audit-log, environment, git-context, system-prompt, max-iterations. Concrete gaps vs Claude Code / goose:

- **File tools are thin.** No Grep, no Glob. `read_file` has no `offset/limit` — large files destroy context. `edit_file` only does unique `str_replace` + `create`; no `replace_all`, no multi-edit.
- **Shell is weak.** `run_command` caps at 30s / 1MB, no background/streaming, no timeout argument, and doesn't honour the `AbortSignal` (uses `promisify(exec)`).
- **No WebFetch.** `search_web` uses DuckDuckGo's zero-click JSON; the agent cannot pull and read arbitrary URLs.
- **No context compaction.** Long sessions hit the token ceiling with no summarisation hook. This is the #1 reason long runs fail.
- **No persistent memory.** No `AGENTS.md` loader (project + user), no cross-session state.
- **No permission/policy system.** `preToolUse` exists but there's no first-class policy matching [packages/agent-spawn/src/types.ts](packages/agent-spawn/src/types.ts) (`read | edit | yolo`).
- **Hook surface is minimal.** Only pre/postToolUse + pre/postIteration. Missing: `sessionStart`, `userPromptSubmit`, `preCompaction`, `postCompaction`, `notification`, `stop`.
- **Tool results are text-only.** No images, no structured error shape — the model cannot self-repair from a parse error or look at a screenshot.

### Out of scope

- **TodoWrite / plan primitives.** Explicitly dropped.
- **Prompt-cache breakpoints.** Anthropic-only — skip.
- **`spawn` changes.** Current `spawn(task)` is fine; no new sub-agent types.
- UI changes (design-system, dashboard), CLI argument surface, breaking changes to `AgentPlugin` API.

## 2. Principles

- Every feature ships as a plugin in [packages/poe-agent/src/plugins](packages/poe-agent/src/plugins). The core stays minimal.
- One plugin per responsibility. No god plugin.
- No `if (agent === 'x')` branching — declarative plugin config only.
- Policy mode names match [packages/agent-spawn/src/types.ts](packages/agent-spawn/src/types.ts): `read | edit | yolo`.
- Tests follow CLAUDE.md unit-test rules (fast, `memfs`, mocked LLMs).

## 3. Design

### 3.1 Tool upgrades (existing plugins)

[poe-agent-plugin-files.ts](packages/poe-agent/src/plugins/poe-agent-plugin-files.ts):

- `read_file`: add optional `offset`, `limit` (line-based).
- `edit_file`: add `replace_all: boolean` for `str_replace`; add an `overwrite` command for full rewrites (distinct from `create`, which keeps its "fail if exists" behaviour).
- Add `grep` tool — ripgrep-backed content search: `pattern`, `path`, `glob`, `output_mode` (files_with_matches | content | count), `-n`, `-i`.
- Add `glob` tool — filename pattern match via `fast-glob`, results sorted by mtime.

[poe-agent-plugin-shell.ts](packages/poe-agent/src/plugins/poe-agent-plugin-shell.ts):

- Expose `timeout` argument (default 120s, max 600s).
- Add `run_in_background: boolean`; returns a handle. Add `read_background(handle)` and `kill_background(handle)` tools.
- Thread the run's `AbortSignal` into `child_process.spawn` so cancellation actually kills the process tree.
- Stream stdout/stderr as `notification` hook events for long-running commands.

[poe-agent-plugin-web.ts](packages/poe-agent/src/plugins/poe-agent-plugin-web.ts):

- Add `fetch_url` — GET an arbitrary URL, convert HTML → markdown (use `turndown`), return with length cap and `offset` for pagination.

### 3.2 New plugin: `poe-agent-plugin-compaction`

Triggers when `tokenCount` crosses a configurable threshold (default 80% of the model's context window). Summarises messages older than a watermark into a single system note, keeps the last N turns verbatim, emits `preCompaction` / `postCompaction` hooks.

- Config: `threshold`, `keepLastTurns`, custom `summarise(messages)`.
- Uses the run's own `AcpModel` for summarisation — no new dependency.
- Audit-log plugin hooks `postCompaction` to persist what was dropped.

### 3.3 New plugin: `poe-agent-plugin-memory`

Loads `AGENTS.md` (vendor-neutral, not `CLAUDE.md`) from:

1. The run's `cwd` (project memory) — walks up to find it.
2. `$HOME/.config/poe-code/AGENTS.md` (user memory).

Both prepend to the system prompt. Supports `@path/to/file` imports so teams can split memory across files. Read-only — memory is authored by humans.

### 3.4 New plugin: `poe-agent-plugin-policy`

Three modes, matching `@poe-code/agent-spawn`:

| Mode  | Behaviour |
|-------|-----------|
| `read` | Blocks any tool that mutates: `edit_file`, `overwrite`, `create`, `run_command` (unless allowlisted read-only), `fetch_url` non-GET. |
| `edit` | Allows file edits and safe shell. Blocks destructive commands (`rm -rf`, `git push`, network writes) unless allowlisted. |
| `yolo` | Allows everything. |

Implementation:

- Each `Tool` declares its own policy metadata: `policy: { read: boolean; edit: boolean; yolo: true }`. Policy is *derived from the tool*, not central config — no switch statement on tool name.
- The policy plugin reads the active mode once at `sessionStart` and enforces via `preToolUse`.
- Command-level policy uses `shell-quote` to parse `run_command` structure — no regexes.

### 3.5 Expanded hook surface

Extend [packages/poe-agent/src/runtime/plugin-types.ts](packages/poe-agent/src/runtime/plugin-types.ts):

| Hook | Fires |
|------|-------|
| `sessionStart(ctx)` | Before the first iteration. Plugins inject system prompt, seed messages, resolve policy. |
| `userPromptSubmit(ctx)` | After each user message is added. Can reject, rewrite, or enrich. |
| `preIteration` / `postIteration` | Already exist. |
| `preToolUse` / `postToolUse` | Already exist. |
| `preCompaction(ctx)` | Before compaction runs. Can force/skip. |
| `postCompaction(ctx)` | After compaction, with the summary. |
| `notification(ctx)` | Informational events (long tool running, waiting on user, background process output). |
| `stop(ctx)` | Before run finalises. Last chance to veto exit. |

All hooks follow the existing `HookDecision` contract (`skip | abort | { reject: string } | void`).

### 3.6 Multimodal tool results

Change `Tool.call` return type from `string` to `ToolResult`:

```ts
type ToolResultPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }       // base64
  | { type: "error"; code: string; message: string; retriable: boolean };

type ToolResult = string | ToolResultPart | ToolResultPart[];
```

- `string` returns stay supported (auto-wrapped as `{ type: "text" }`).
- `read_file` on image mime types returns `{ type: "image" }`.
- Tools surface structured errors so the model can decide whether to retry instead of guessing.
- ACP layer serialises each part to the corresponding provider-specific shape.

## Task Board

- [x] `read_file` offset/limit; `edit_file` `replace_all` + `overwrite` command
- [ ] Add `grep` and `glob` tools (ripgrep + `fast-glob`)
- [ ] Rework `run_command`: `timeout` arg, `run_in_background` + `read_background` + `kill_background`, `AbortSignal` propagation
- [ ] Add `fetch_url` (HTML → markdown via `turndown`, paginated)
- [ ] Switch `Tool.call` return to `ToolResult` (text/image/error); thread through ACP
- [ ] Extend `AgentPlugin` hooks: `sessionStart`, `userPromptSubmit`, `preCompaction`, `postCompaction`, `notification`, `stop`
- [ ] New plugin `poe-agent-plugin-compaction` — threshold-based summarisation using the run's model
- [ ] New plugin `poe-agent-plugin-memory` — load `AGENTS.md` from cwd walk-up + `$HOME/.config/poe-code/`, support `@import`
- [ ] New plugin `poe-agent-plugin-policy` — `read | edit | yolo` modes, per-tool policy metadata, `shell-quote` command parser
- [ ] Unit tests for every new plugin and every changed tool (`memfs` + mocked `AcpModel`)
- [ ] Update [packages/poe-agent/README.md](packages/poe-agent/README.md) with new env vars / config options
