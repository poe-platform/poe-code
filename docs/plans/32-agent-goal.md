---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent goal — autonomous objective with budget & continuation

Port the `/goal` concept from Codex (`codex-rs/core/src/goals.rs`) into poe-code as a thin layer on top of `agent-spawn`: a named, budgeted objective that the agent pursues across multiple turns until it marks itself `complete` or `blocked`, with hidden steering prompts injected each turn.

## 1. What we're building

A new package `@poe-code/agent-goal` plus CLI/interactive surface area for managing a single active goal per project (cwd). A goal is a `{ objective, status, tokenBudget?, tokensUsed, secondsUsed }` record, persisted to a JSON file under `<config-state-dir>/goals/<projectHash>.json`. The goal runner repeatedly invokes the agent through `spawnAutonomous` (existing) until status reaches a terminal value, injecting one of three steering prompts at each turn boundary.

Three tools are exposed to the spawned agent over MCP — `create_goal`, `get_goal`, `update_goal` — wired by the same `agent-mcp-config` plumbing used by other in-repo MCP servers.

Non-goals:

- No parallel goals. One goal per project, matching codex's one-goal-per-thread invariant and the [[project_sequential_only]] working assumption.
- No wall-clock budget enforcement in v1. Time is tracked and surfaced, not enforced.
- No mid-turn steering injection. poe-code spawns one-shot agents; we only inject at turn boundaries via the spawn `prompt` field.
- No TUI changes in v1 beyond goal status as an existing maestro-tui status line entry. A dedicated goal pane is out of scope.
- No cross-project goals or goal-of-goals.

## 2. User-facing shape

### CLI (always available, parity with interactive)

```
poe-code goal create <objective> [--token-budget N] [--service <id>] [--model <id>]
poe-code goal get
poe-code goal pause
poe-code goal resume
poe-code goal clear
poe-code goal run                              # blocks; drives the autonomous loop
poe-code goal run --detach                     # delegate to runner-e2b detached job
```

`goal create` writes the goal and exits. The agent does not start. `goal run` is the explicit autonomous driver — keeps the user in control of when the loop fires, per [[project_overnight_detach_workflow]]. No implicit background continuation.

### Interactive slash command (inside `poe-code chat`)

```
/goal                       # opens summary + edit menu (uses design-system select)
/goal <objective>           # create
/goal edit                  # change objective on active goal
/goal pause | resume | clear
```

Slash command surface is one-to-one with CLI subcommands. No new behavior.

### Tools the agent sees (MCP)

```
create_goal({ objective: string, tokenBudget?: number }) -> Goal
get_goal()                                              -> Goal
update_goal({ status: "complete" | "blocked" })         -> Goal
```

Same descriptions as codex (`codex-rs/core/src/tools/handlers/goal_spec.rs`): `create_goal` fails if a goal exists, `update_goal` only accepts `complete` or `blocked` — pause/resume/budget_limited transitions are reserved for system + user. The 3-consecutive-blocked-turns rule is stated in the tool description and enforced server-side: an `update_goal({status:"blocked"})` call before the goal's `blockedTurnCount` reaches 3 returns an error response and increments the counter; on 3, the status flips and the tool returns success.

### State file

`<config-state-dir>/goals/<sha256(cwd).slice(0,16)>.json`:

```ts
type Goal = {
  goalId: string; // UUID
  cwd: string; // absolute project path; matches the file hash
  objective: string; // 1..4000 chars
  status: "active" | "paused" | "blocked" | "usage_limited" | "budget_limited" | "complete";
  tokenBudget: number | null;
  tokensUsed: number;
  secondsUsed: number;
  blockedTurnCount: number; // resets on resume, on objective edit, and on create_goal
  createdAt: string; // ISO8601
  updatedAt: string;
};
```

One file = one goal. Atomic writes via `@poe-code/file-lock` (already in this repo). No SQLite — sticks with the existing JSON-state pattern used by `@poe-code/memory` and `@poe-code/auth-store`.

## 3. Implementation

### Package layout — `packages/agent-goal/`

```
src/
  index.ts                  # public exports
  types.ts                  # Goal, GoalStatus, GoalRunOptions
  store.ts                  # load/save/clear; file-lock-guarded; memfs-testable
  templates/
    continuation.md
    budget-limit.md
    objective-updated.md
  template.ts               # renderTemplate(name, vars) — no handlebars, mustache-style {{ var }} only
  steering.ts               # buildSteeringMessage(goal, kind) -> string wrapped in <goal_context>
  runner.ts                 # runGoal(options): orchestrates spawnAutonomous loop
  mcp/
    server.ts               # MCP server exposing create/get/update tools
    handlers.ts             # validation, blockedTurnCount enforcement
  cli/
    program.ts              # registers `goal` subcommand on the root CLI
    interactive.ts          # `/goal` slash command handler
  README.md                 # env vars (none), config (state dir), tool list
```

### Steering injection

`runner.ts` is the heart. Pseudocode (real code is TDD-written):

```ts
async function runGoal(opts: GoalRunOptions): Promise<void> {
  const store = openGoalStore(opts.cwd);
  let firstTurn = true;
  let lastObjective = (await store.read())?.objective;

  while (true) {
    const goal = await store.read();
    if (!goal) throw new GoalNotFoundError(opts.cwd);
    if (isTerminal(goal.status)) return;
    if (goal.status === "paused" || goal.status === "blocked") return;

    const kind: SteeringKind = firstTurn
      ? "initial"
      : goal.objective !== lastObjective
        ? "objective_updated"
        : goal.status === "budget_limited"
          ? "budget_limit"
          : "continuation";

    const steering = buildSteeringMessage(goal, kind);
    const result = await spawnAutonomous(streamingSpawn, {
      ...opts.spawnOptions,
      prompt: kind === "initial" ? goal.objective : steering
      // mcp goal-server is wired in via opts.spawnOptions.mcpServers
    });

    await store.update((g) => accountUsage(g, result.usage));
    firstTurn = false;
    lastObjective = goal.objective;
  }
}
```

`accountUsage` adds `inputTokens + outputTokens` to `tokensUsed`, adds wall-clock delta to `secondsUsed`, and flips status to `budget_limited` when `tokenBudget !== null && tokensUsed >= tokenBudget`. The next iteration sees `budget_limited` and injects the `budget-limit.md` template, then the agent is expected to wrap up (call `update_goal({status:"complete"})` or stop tool use).

The first turn uses the bare `objective` as the prompt — no `<goal_context>` wrapping — so a non-MCP-aware agent still sees a normal user message. Subsequent turns (continuation/budget-limit/objective-updated) wrap the steering in `<goal_context>...</goal_context>`, matching codex's `goal_context.rs` markers.

### Templates

Copied directly from `codex-rs/core/templates/goals/`, with `{{ var }}` syntax for `objective`, `tokens_used`, `token_budget`, `remaining_tokens`, `time_used_seconds`. No handlebars/mustache library — `template.ts` is ~15 lines of `replace` with strict variable allow-listing. Per [[feedback_explicit_over_implicit]], unknown variables throw at render time, never silently empty-string.

### MCP server

The `mcp/server.ts` is a `stdio` MCP server using the existing in-repo MCP utilities (`@poe-code/agent-mcp-config` for config wiring). It reads/writes the same goal file as the CLI through `store.ts`, so CLI and tool calls share a single source of truth.

`update_goal` enforcement:

- `status="complete"`: always allowed, status → `complete`, returns goal with a `completionBudgetReport` string when a budget exists.
- `status="blocked"`: increments `blockedTurnCount`. If it reaches 3, status → `blocked` and the count resets. If under 3, status stays `active`, tool returns an error response that quotes the current count and the 3-turn rule. (This mirrors codex's behavior but is enforced server-side instead of relying on the model.)

### Wiring into existing surfaces

- `packages/agent-mcp-config`: add `goal` as a built-in MCP server under `mcpServers.goal = { command: "poe-code", args: ["goal", "mcp-server"], env: { POE_CODE_GOAL_CWD: cwd } }`. The server inherits the project cwd from env so the spawned agent edits the right state file.
- `packages/agent-spawn`: no changes. `goal run` composes `spawnAutonomous` from outside.
- Root CLI (`src/cli/program.ts`): register `goal` subcommand. Same pattern used by `maestro` (lines ~473-554).
- `packages/maestro-tui`: read goal status from the goal file and surface in the existing status row. Reuse `@poe-code/file-lock` to avoid mid-write reads. No new widget.

### Persistence & locking

`store.ts` exports:

```ts
openGoalStore(cwd: string): {
  read(): Promise<Goal | null>;
  create(input: CreateGoalInput): Promise<Goal>;
  update(mut: (g: Goal) => Goal): Promise<Goal>;
  clear(): Promise<void>;
}
```

All writes use `@poe-code/file-lock`'s `withLock(path, fn)`. Reads do not take the lock but tolerate partial writes (parse fail → retry once after 50ms; second fail → throw).

### Events

Each `runner.ts` iteration logs a structured event line to `<state-dir>/goals/<hash>.events.ndjson`:

```
{"ts":"...","kind":"turn_started","goalId":"...","tokensUsed":42,"status":"active"}
{"ts":"...","kind":"turn_finished","goalId":"...","tokensUsed":113,"status":"active"}
{"ts":"...","kind":"status_changed","goalId":"...","from":"active","to":"budget_limited"}
{"ts":"...","kind":"status_changed","goalId":"...","from":"active","to":"complete"}
```

NDJSON because it lines up with the existing maestro event stream pattern and lets the TUI tail without parser changes.

## 4. Interfaces & tests

### Public exports (`packages/agent-goal/src/index.ts`)

```ts
export { runGoal } from "./runner.js";
export { openGoalStore } from "./store.js";
export { buildSteeringMessage } from "./steering.js";
export { renderTemplate } from "./template.js";
export type { Goal, GoalStatus, GoalRunOptions, CreateGoalInput, SteeringKind } from "./types.js";
```

### Tests (TDD; all written before code per AGENTS.md/project instructions)

**Unit, memfs-backed:**

- `store.test.ts`
  - create writes file with new uuid, status=active, counts=0, blockedTurnCount=0
  - create rejects when an active goal exists
  - update is atomic under concurrent writers (spawn 5 parallel `update`s, all increments visible)
  - clear removes file
  - read returns null when file missing
  - read retries once on partial write, throws on second failure

- `template.test.ts`
  - renderTemplate replaces every `{{ var }}`
  - unknown variables in template throw at render
  - extra variables in input are ignored
  - HTML-special chars in `objective` are XML-escaped inside `<untrusted_objective>` for the objective-updated template (matches codex)

- `steering.test.ts`
  - `continuation` wraps in `<goal_context>` and includes remaining-tokens calc (`budget - used`)
  - `budget_limit` includes "wrap up this turn soon" phrasing
  - `objective_updated` wraps the new objective in `<untrusted_objective>`
  - no template variables leak unrendered (greps the output for `{{`)

- `handlers.test.ts`
  - `create_goal` rejects empty objective
  - `create_goal` rejects objective >4000 chars
  - `create_goal` rejects non-positive tokenBudget
  - `create_goal` fails when goal exists, suggests `update_goal`
  - `update_goal({status:"complete"})` flips status, returns `completionBudgetReport` when budget set
  - `update_goal({status:"blocked"})` increments count, stays active at count<3, flips at count=3
  - `update_goal({status:"blocked"})` resets count after a successful flip

- `runner.test.ts` (mocks `spawnAutonomous`)
  - terminates on `complete`
  - terminates on `paused`
  - first turn sends bare objective (no `<goal_context>`)
  - second turn sends continuation template wrapped in `<goal_context>`
  - objective edit between turns triggers `objective_updated` template
  - exceeding tokenBudget after a turn flips status to `budget_limited` and the next turn uses `budget-limit.md`
  - blocked status returned by handler exits the loop (no further turns)
  - usage accounting is durable: counters survive across runs (write, restart, read)

**CLI snapshot tests:** `goal create`, `goal get`, `goal pause`, `goal resume`, `goal clear` — render via design-system, snapshot the output. Follows `docs/SNAPSHOT_TESTING.md`.

**Visual:** `npm run screenshot-poe-code -- goal create "improve test coverage" --token-budget 50000`, `npm run screenshot-poe-code -- goal get`. No screenshot tests committed; screenshots are only used during implementation review.

**E2E (one):** `goal run` against the bundled poe-agent with a trivial objective ("create file foo.txt with text bar") and a tokenBudget high enough to allow completion. Asserts: file appears in cwd; final status is `complete`; event log contains turn_started/turn_finished/status_changed=complete.

### Test infrastructure already in place

- `memfs` — required for `store.ts` tests
- `@poe-code/file-lock` — already memfs-aware via its own tests
- `vitest` — repo standard
- No LLM in unit tests; `runner.test.ts` mocks `spawnAutonomous` with a fake that returns `SpawnResult` shapes only.

## 5. Code references (codex source map)

These point at the upstream implementation to reference when writing each part:

- Tool descriptions / param schemas → `codex-rs/core/src/tools/handlers/goal_spec.rs` (~120 lines)
- Tool handler logic → `codex-rs/core/src/tools/handlers/goal/{create_goal,get_goal,update_goal}.rs`
- Status enum + lifecycle → `codex-rs/state/src/model/thread_goal.rs`
- 3-turn blocked rule (description side) → `goal_spec.rs:68-84`
- Steering markers (`<goal_context>` wrapping) → `codex-rs/core/src/context/goal_context.rs`
- Continuation/budget-limit/objective-updated templates → `codex-rs/core/templates/goals/{continuation,budget_limit,objective_updated}.md`
- Token-budget transition logic → `codex-rs/core/src/goals.rs:994-1102` (`account_thread_goal_progress`)
- Continuation skip during plan mode → `codex-rs/core/src/goals.rs:1387` (deferred — poe-code has no plan-mode equivalent in v1)

## 6. Out of scope (deferred, named so they're not forgotten)

- **UsageLimited state.** Codex uses it when the provider returns a quota error mid-turn. poe-code has no unified quota signal yet; defer until [[provider abstraction]] surfaces one.
- **Wall-clock budget enforcement.** Track only.
- **Plan-mode interaction.** No analogue exists in poe-code today.
- **Goal-aware TUI pane in maestro-tui.** Status-line surfacing is enough for v1.
- **Multi-goal queue.** Sequential-only is the working assumption.
- **Parallel sub-agents working on goal subtasks.** Belongs to the superintendent loop, not the goal runner.
