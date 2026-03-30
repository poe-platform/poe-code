# Ralph Init — Frontmatter-Driven Config

## Goal

Add `ralph init` command that writes `agent` and `iterations` into plan frontmatter, so `ralph run` reads them and skips prompting.

## Current State

- Frontmatter schema: `{ status, iteration }` — no agent/iterations config
- `ralph run` always resolves agent + iterations via CLI args or interactive prompts
- Agent is a single string, resolved at CLI layer

## New Frontmatter Schema

```yaml
---
status: pending
iteration: 0
agent: claude-code          # string or string[]
iterations: 5               # max iterations for this plan
---
```

- `agent`: `string | string[]` — when array, cycle through agents round-robin per iteration
- `iterations`: `number` — max iterations to run

## Implementation Steps

### 1. Extend frontmatter (package: `@poe-code/ralph`)

**File: `packages/ralph/src/frontmatter/frontmatter.ts`**

- Add optional fields to `RalphFrontmatter`:
  ```ts
  agent?: string | string[];
  iterations?: number;
  ```
- Update `parseFrontmatter` to extract these fields with validation:
  - `agent`: string or array of strings, optional
  - `iterations`: positive integer, optional
- Update `writeFrontmatter` — already generic, just works with new fields
- **Tests**: parse/write round-trip with agent string, agent array, iterations, and combinations

### 2. Add `ralph init` command (CLI layer)

**File: `src/cli/commands/ralph.ts`**

Register `ralph init` subcommand under the existing `ralph` command:

```
poe-code ralph init [doc]
  --agent <name>         Agent to use (string written to frontmatter)
  --iterations <n>       Number of iterations
```

**Interactive flow** (when args not provided and not `--yes`):
1. Select existing doc (reuse `resolveDocPath` from `run`)
2. If doc already has frontmatter config, display it concisely: e.g. `Current: 10, codex, codex, claude`
   (format: iterations, then agent list — expanded from array or single repeated)
3. Select agent — single select from `allSpawnConfigs`
4. Enter iteration count

**`--yes` flow**: defaults: agent=claude-code, iterations=3

**Behavior**:
- Doc must already exist — error if not found
- Read doc, parse frontmatter, overwrite `agent` and `iterations` (preserve body + status/iteration)
- Write frontmatter with updated fields

Note: To set an agent array for cycling, user edits frontmatter YAML directly (e.g. `agent: [claude-code, codex]`). The CLI `init` only writes a single agent string.

### 3. Update `ralph run` to read frontmatter config

**File: `src/cli/commands/ralph.ts`** — in the `run` action:

Remove the `[iterations]` positional argument from `ralph run`. Iterations now come from frontmatter or `--iterations` flag.

After resolving `docPath`, read the file and parse frontmatter. Validate agent names in frontmatter before starting the loop — fail fast if any agent is unknown.

Use frontmatter values as defaults:

- If frontmatter has `agent`: skip agent prompt, use frontmatter value
  - CLI `--agent` flag still overrides frontmatter
- If frontmatter has `iterations`: skip iterations prompt, use frontmatter value
  - CLI `--iterations` flag still overrides frontmatter
  - Default: 3 if no source provides iterations

**New `ralph run` signature:**
```
poe-code ralph run [doc]
  --agent <name>         Override agent from frontmatter
  --iterations <n>       Override iterations from frontmatter
  --model <model>        Model override
```

**Priority** (highest to lowest):
1. CLI flags
2. Frontmatter values
3. Interactive prompts (if neither provided)

**CRITICAL: `updateFrontmatter` in `ralph.ts` must preserve `agent` and `iterations` fields.** Currently it only writes `{ status, iteration }`. After this change it must carry forward `agent`/`iterations` so they aren't wiped during a run.

### 4. Agent cycling in run loop

**File: `packages/ralph/src/run/ralph.ts`**

- Change `RalphRunOptions.agent` from `string` to `string | string[]`
- In the iteration loop, resolve current agent:
  ```ts
  const agents = Array.isArray(options.agent) ? options.agent : [options.agent];
  const currentAgent = agents[(iteration - 1) % agents.length];
  ```
- Pass `currentAgent` to `runAgent()` call
- `onIterationStart` callback should include agent name so CLI can log which agent is running each iteration

### 5. SDK layer update

**File: `src/sdk/ralph.ts`**

- Update `RalphRunOptions` type re-export to include new agent type
- If `agent` is array, the SDK `runAgent` callback cycles through them (handled by core package)

## Test Plan

All unit tests use `memfs` + `createRalphSimulation`.

1. **Frontmatter parsing**: agent string, agent array, iterations, missing fields, invalid values
2. **Frontmatter writing**: round-trip with new fields
3. **`ralph init`**:
   - Updates existing doc preserving body
   - Errors on non-existent doc
   - CLI args flow (no prompts)
4. **`ralph run` with frontmatter config**:
   - Reads agent from frontmatter, skips prompt
   - Reads iterations from frontmatter, skips prompt
   - CLI args override frontmatter
   - Falls back to prompt when neither provided
   - Defaults to 3 iterations when no source provides a value with --yes
   - Fails fast on unknown agent names in frontmatter
   - Preserves agent/iterations in frontmatter through run lifecycle
5. **Agent cycling**:
   - Single agent: same agent every iteration
   - Array of 2 agents, 5 iterations: cycles correctly (a, b, a, b, a)
   - Array of 3 agents, 3 iterations: one each

## File Changes Summary

| File | Change |
|------|--------|
| `packages/ralph/src/frontmatter/frontmatter.ts` | Add `agent`, `iterations` to schema |
| `packages/ralph/src/frontmatter/frontmatter.test.ts` | New test cases |
| `packages/ralph/src/types.ts` | `agent: string → string \| string[]` |
| `packages/ralph/src/run/ralph.ts` | Agent cycling logic |
| `packages/ralph/src/run/ralph.test.ts` or simulation | Cycling tests |
| `src/cli/commands/ralph.ts` | Add `init` subcommand, update `run` to read frontmatter |
| `src/sdk/ralph.ts` | Type update |

## Edge Cases

- Empty agent array → validation error
- Agent array with one element → same as string
- Frontmatter `iterations: 0` or negative → ignore (fall through to prompt/CLI)
- `ralph run` with both CLI `--agent` and frontmatter agent → CLI wins
- Unknown agent in frontmatter → validation error before loop starts
- `ralph run` must not wipe `agent`/`iterations` from frontmatter during execution
