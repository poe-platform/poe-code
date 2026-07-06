---
kind: archived-pipeline-plan
version: 1
source: plan-session-replay.yaml
task_count: 3
---

# Session Replay

Archived pipeline plan. The original YAML is retained below for provenance.

````yaml
vars:
  plan_doc: "{{file 'docs/plans/session-replay.md'}}"

tasks:
  # ── Step 1: Core replay logic ───────────────────────────────────────

  - id: replay-core
    title: Implement JSONL parsing and replay helpers
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/agent-spawn/src/acp/replay.ts` with these functions:

      1. **`readSpawnLog(path: string): AsyncIterable<AcpEvent>`**
         - Read the JSONL file at the given path
         - Parse each line as JSON and yield it as an `AcpEvent`
         - Skip blank lines gracefully

      2. **`listSpawnLogs(options?: { limit?: number }): Promise<LogEntry[]>`**
         - Scan `~/.poe-code/spawn-logs/` for `.jsonl` files
         - Parse filenames for metadata (timestamp, agent name)
         - Return sorted by filename (newest first), capped at `limit` (default 80)
         - `LogEntry` should include: `path`, `filename`, `agent` (if derivable), `timestamp` (if derivable)

      3. **`findLatestLog(agent?: string): Promise<string | undefined>`**
         - Call `listSpawnLogs()`, optionally filter by agent name
         - Return the path of the most recent match

      4. **`pickRandomLog(agent?: string): Promise<string | undefined>`**
         - Call `listSpawnLogs()`, optionally filter by agent name
         - Return a random path from the list

      5. **`replaySpawnLog(path: string): Promise<void>`**
         - Call `readSpawnLog(path)` to get the async iterable
         - Pipe it through the existing `renderAcpStream()` from `renderer.ts`

      Import the existing `AcpEvent` type from `packages/agent-spawn/src/acp/types.ts`.
      Import `renderAcpStream` from `packages/agent-spawn/src/acp/renderer.ts`.

      Use `node:fs/promises` and `node:readline` for file reading.

      Write tests in `packages/agent-spawn/src/acp/replay.test.ts`:
      - `readSpawnLog` yields parsed AcpEvent objects from a JSONL file
      - `readSpawnLog` skips blank lines
      - `listSpawnLogs` returns sorted log entries
      - `listSpawnLogs` filters by agent name
      - `findLatestLog` returns the most recent log path
      - `pickRandomLog` returns a valid log path
      - Use `memfs` for all filesystem operations (no real filesystem)

      Reference: {{plan_doc}}

  # ── Step 2: CLI entrypoint ──────────────────────────────────────────

  - id: replay-cli
    title: Create minimal CLI entrypoint for replay
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Create `packages/agent-spawn/src/acp/replay-cli.ts` — a minimal entrypoint script.

      Parse `process.argv` directly (no commander or other CLI framework). Support:

      - `--list` — call `listSpawnLogs()` and print a table of available logs (limit to 80 entries)
      - `--latest [agent]` — call `findLatestLog(agent)` and replay it
      - `--random [agent]` — call `pickRandomLog(agent)`, print the resolved path, then replay
      - `<file>` (positional arg) — replay the given file path directly
      - No args — replay the most recent log (same as `--latest`)

      Each mode should call `replaySpawnLog(path)` to do the actual rendering,
      except `--list` which just prints the table.

      Print errors to stderr and exit with code 1 on failure (e.g. no logs found, file not found).

      For `--random`, print the resolved file path to stderr before replaying so the
      user can re-replay it by path.

      Import all helpers from `./replay.ts`.

      Reference: {{plan_doc}}

  # ── Step 3: npm script ──────────────────────────────────────────────

  - id: npm-script
    title: Add replay npm script to root package.json
    status:
      implement: done
      refactor: done
      test: done
      commit: done
    prompt: |
      Add a `replay` script to the root `package.json`:

      ```json
      "replay": "tsx packages/agent-spawn/src/acp/replay-cli.ts"
      ```

      Verify it works by running `npm run replay -- --list`. If there are no logs
      available, verify the command runs without errors and shows an empty list or
      a helpful message.

      Reference: {{plan_doc}}
````
