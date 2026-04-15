---
agent:
  - claude-code
status:
  state: draft
---
# Session Replay — Pretty-render recorded agent sessions

## Problem

We already record full ACP event streams as JSONL files via the `spawnLog` middleware (`~/.poe-code/spawn-logs/*.jsonl`). There's no way to replay them visually. We need a CLI command to replay any JSONL log file through the design system renderer so we can evaluate output quality, debug agent behavior, and review sessions after the fact.

## What already exists

| Component | Location | Status |
|-----------|----------|--------|
| JSONL recording | `packages/agent-spawn/src/acp/middlewares/spawn-log.ts` | Done — writes to `~/.poe-code/spawn-logs/` |
| ACP event types | `packages/agent-spawn/src/acp/types.ts` | Done — `AcpEvent` union type |
| Stream renderer | `packages/agent-spawn/src/acp/renderer.ts` | Done — `renderAcpStream()` with buffering |
| Design system components | `packages/design-system/src/acp/components.ts` | Done — terminal rendering primitives |
| Output format switching | `packages/design-system` | Done — `plain`, `json`, `markdown` |

Key insight: claude-code logs include tool `input` and full `path` (output) on events. Codex logs only have titles. The replay should work with whatever data is present.

## Plan

### Usage

```bash
npm run replay                     # replay the most recent log
npm run replay -- --latest claude  # replay the most recent claude-code log
npm run replay -- --random         # replay a random log (prints path for re-replay)
npm run replay -- --random claude  # replay a random claude-code log
npm run replay -- --list           # list available logs
npm run replay -- path/to/file.jsonl  # replay a specific file (e.g. re-replay a --random pick)
```

### Step 1: Core replay logic in agent-spawn package

File: `packages/agent-spawn/src/acp/replay.ts`

Responsibilities:
1. **Parse JSONL** — read file, split lines, parse each as `AcpEvent`
2. **Create async iterable** — yield events so `renderAcpStream()` works unchanged
3. **List logs** — scan `~/.poe-code/spawn-logs/`, parse filenames for metadata
4. **Find latest** — sort by filename (already timestamp-ordered), optionally filter by agent
5. **Pick random** — select a random log from the list, optionally filter by agent, print the resolved path so the user can re-replay it by path

### Step 2: Entrypoint script

File: `packages/agent-spawn/src/acp/replay-cli.ts`

Minimal script — parse argv, call replay helpers, pipe to `renderAcpStream()`. No commander, just `process.argv`.

### Step 3: npm script

`package.json` (root): `"replay": "tsx packages/agent-spawn/src/acp/replay-cli.ts"`

### Step 4: Tests

- `packages/agent-spawn/src/acp/replay.test.ts` — test JSONL parsing, async iterable creation, log listing, latest resolution
- Use `memfs` for file operations, no real filesystem

## Architecture

```
npm run replay [args]
  │
  └─ replay-cli.ts (entrypoint)
       │
       ├─ --list → listSpawnLogs() → print table
       ├─ --latest [agent] → findLatestLog() → resolve path
       ├─ --random [agent] → pickRandomLog() → resolve path, print it
       └─ <file> → replaySpawnLog(path)
                      │
                      ├─ readSpawnLog(path) → AsyncIterable<AcpEvent>
                      └─ renderAcpStream(events)  ← existing renderer, unchanged
```

No changes to existing code. Pure additive feature.

## Non-goals

- Exposed CLI command — this is internal tooling only
- Speed control / animated playback (events replay instantly, like `cat`)
- Interactive TUI (pause/resume/step)
- Recording changes — the spawnLog middleware is already fine

## File changes

| File | Change |
|------|--------|
| `packages/agent-spawn/src/acp/replay.ts` | **New** — JSONL parsing, log listing, replay helpers |
| `packages/agent-spawn/src/acp/replay.test.ts` | **New** — unit tests |
| `packages/agent-spawn/src/acp/replay-cli.ts` | **New** — minimal entrypoint script |
| `package.json` (root) | **Edit** — add `replay` npm script |
