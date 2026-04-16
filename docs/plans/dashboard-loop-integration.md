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
      Make sure this code follows convention and good architecture. Outline any issues.

  developer-experience:
    agent: claude-code
    prompt: |
      Replay the builder's session with `npm run replay -- {{builder.log_path}}`
      and suggest developer-experience improvements. It's ok to pass if there's nothing significant

  testing:
    agent: claude-code
    mcp:
      terminal-pilot:
        command: npx
        args: [ terminal-pilot-mcp ]
    prompt: |
      Use terminal-pilot to drive the dashboard end-to-end and verify it behaves
      as the plan describes.

superintendent:
  agent: claude-code
  prompt: |
    Review the builder and inspector output, update the Task Board in {{plan.path}},

    Ask builder for rework based on feedback from inspectors.
    Request owner review when the board is complete and there's nothing left to do or add.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Code quality
    {{inspectors.code-quality}}

    ## Developer experience
    {{inspectors.developer-experience}}

    ## Testing
    {{inspectors.testing}}

owner:
  agent: claude-code
  prompt: |
    Decide whether the work is done. Approve or send back with feedback.

    Ask yourself question: Is this the best experience our users could be getting?

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 100

status:
  state: in_progress
  round: 44
  review_turn: 0
---

# Dashboard Loop Integration

Wire the existing `@poe-code/design-system` dashboard component into the pipeline, ralph, and experiment runtime loops so long-running CLI commands show a live split-pane TUI instead of a scrolling log.

## 1. Problem

### What hurts today

All three long-running loops — `pipeline`, `ralph`, `experiment` — report progress as a linear stream of logger lines. For runs that take minutes to hours across many iterations, this is hard to follow:

- You can't see current status at a glance — the last interesting line scrolls away as soon as the next tool call prints.
- Cumulative stats (iteration N/M, elapsed time, token totals) exist inside the callbacks but are never surfaced coherently — you have to mentally aggregate log lines.
- There is no interactive control surface. The loops already support cancellation via `AbortSignal`, but you can only hit Ctrl-C; there's no pause, no scroll-back, no "edit the plan/doc mid-run".
- The dashboard component (`packages/design-system/src/dashboard/`) was built specifically for this use case — split-pane output + stats + keyboard commands — but nothing consumes it yet. It ships dead code.

### Evidence this is worth doing now

- Dashboard landed in [design-system-dashboard.md](design-system-dashboard.md) as a standalone deliverable and is feature-complete with `start`/`stop`/`appendOutput`/`updateStats`/`onCommand`/`destroy` plus a non-TTY fallback that degrades to the existing logger.
- Each of the three loops already emits the exact events the dashboard needs (`onTaskStart/Complete`, `onIterationStart/Complete`, `onExperimentStart/Complete` + metric/commit hooks). The missing piece is the glue.
- All three loops already accept an `AbortSignal`, which maps cleanly onto the dashboard's `quit` command — so the interactive quit path is essentially free.

### Who benefits

Operators running `poe-code pipeline`, `poe-code ralph`, and `poe-code experiment` interactively — anyone watching a long loop run in a terminal.

### Out of scope

- Redesigning the dashboard itself (layout, keymap, stats schema). The component is treated as fixed.
- Wiring the dashboard into other commands (`configure`, `plan`, `install`, `superintendent`, one-shot `run`). Those are short-lived or non-loop commands; a future plan can extend coverage if warranted.
- Introducing a new shared "runner" abstraction across pipeline/ralph/experiment. The three loops stay independent; integration happens at the CLI-handler layer where callbacks are already wired.
- Persisting dashboard state across runs, remote/web dashboards, or multi-run dashboards.
- Changing what the loops *do* — no new orchestration behavior, only a new presentation layer plus the existing cancel path surfaced through `quit`.

### Decisions

- **Opt-in via `--tui` or config, with `--no-tui` escape hatch.** Dashboard stays off by default and only runs for explicit interactive invocations unless the per-command `tui` config knob enables it. Non-TTY runs still use the existing logger path because each command gates the dashboard behind `resolveOutputFormat() === "terminal"` plus `stdin`/`stdout` TTY checks, and `--no-tui` disables the dashboard for a single run even when config enables it.
- **Only `quit` + scroll are wired.** `edit`, `pause`, `retry` are not hooked up — they have no agreed semantics per loop yet and are out of scope. The CLI integrations pass a reduced footer hint set (`q`, scroll, follow) so the dashboard only advertises commands that work.
- **Child-agent output must reach the left pane in human-readable form.** Pipeline reuses ACP event rendering via `renderAcpEvent` and also buffers tee'd stdout/stderr; Ralph and Experiment wrap `sdkSpawn.autonomous()` in `acp.withAcpWriter()` and tee stderr separately. In all three cases the dashboard receives stage-tagged lines (`task:step`, `iteration:n`, `experiment:n`) rather than raw JSON event streams.

## Task Board

- [x] Finish the feature plan (altitudes 2–5).
- [x] Integrate dashboard into pipeline.
- [x] Integrate dashboard into ralph.
- [x] Integrate dashboard into experiment.
- [x] Stream child-agent output into `appendOutput` from the pipeline integration (render ACP events plus tee stdout/stderr, stage-tagged).
- [x] Stream child-agent output into `appendOutput` from the ralph integration (route `spawnAutonomous` via `acp.withAcpWriter`, stage-tagged, prompts via stdin).
- [x] Stream child-agent output into `appendOutput` from the experiment integration (route `spawnAutonomous` via `acp.withAcpWriter`, stage-tagged, prompts via stdin).
- [x] Extract shared CLI dashboard helpers so pipeline, ralph, and experiment reuse the same duration/timestamp/TTY/line-buffer logic.
- [x] Add `tui` config knob to pipeline, ralph, and experiment config scopes so the dashboard can be enabled by default without `--tui` flag.
- [x] Allow `--no-tui` to override the per-command `tui` config knob for one-off non-dashboard runs.
- [x] Fix broken experiment-loop tests: builder changed `extends` tests from boolean to string but did not update the parser at `packages/experiment-loop/src/frontmatter/frontmatter.ts`. Revert the experiment-loop test changes — they are unrelated to this plan.

## 2. User-facing shape

### CLI surface

```text
poe-code pipeline run --plan .poe-code/pipeline/plans/plan.yaml --agent codex --tui
poe-code ralph run docs/loop.md --agent claude --iterations 5 --tui
poe-code experiment run docs/loop.md --agent claude --max-experiments 5 --tui
```

`--tui` is the only new switch. Without it, all three commands keep their existing logger output.

### End-state dashboard

```text
┌─ Pipeline / Ralph / Experiment Output ───────────────┬─ Run ─────────────┐
│ [12:00:00] Config · Agent: claude-code · ...         │ Status   running  │
│ [12:00:01] Task 2/3: auth-hardening (implement) ...  │ Iter.    1        │
│ [12:00:02] [auth-hardening:implement] Analyzing doc  │ Elapsed  00:00:02 │
│ [12:00:03] [auth-hardening:implement] Drafting ...   │ TokensIn 120      │
│ [12:00:04] Task auth-hardening done in 2s            │ TokensOut 45      │
│                                                      │ Current  Task 2/3 │
├──────────────────────────────────────────────────────┴───────────────────┤
│ q Quit  ↑↓ Scroll  F Follow                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### What each command writes into the dashboard

- **Pipeline**
  - Initial config line with agent/model/plan.
  - Task summary line (`done/failed/open`).
  - Task start + completion lines.
  - Stage-tagged child-agent output like `[auth-hardening:implement] ...`.
  - Stats pane shows iterations completed, token totals, elapsed time, and current task/step.

- **Ralph**
  - Initial config line with agent(s), doc path, and iteration budget.
  - Iteration start + completion lines.
  - Stage-tagged child-agent output like `[iteration:2] ...`.
  - Stats pane shows iteration count, elapsed time, and current iteration/agent.

- **Experiment**
  - Initial config line with agent(s), doc path, and max-experiments limit.
  - Experiment start line.
  - Baseline, metric, commit, reset, and experiment-complete lines.
  - Stage-tagged child-agent output like `[experiment:3] ...`.
  - Stats pane shows experiments completed, elapsed time, and current experiment/agent.

## 3. Implementation details and technical decisions

### Architecture

The integration lives entirely in the CLI layer:

- [src/cli/commands/pipeline.ts](../../src/cli/commands/pipeline.ts)
- [src/cli/commands/ralph.ts](../../src/cli/commands/ralph.ts)
- [src/cli/commands/experiment.ts](../../src/cli/commands/experiment.ts)

That keeps `@poe-code/pipeline`, `@poe-code/ralph`, and `@poe-code/experiment-loop` focused on orchestration and callbacks, while the CLI owns presentation, keyboard handling, and output formatting.

### Dashboard lifecycle per command

Each command follows the same shape:

1. Parse normal CLI options plus `--tui` / `--no-tui`.
2. Call `shouldUse*Dashboard()` to require all of:
   - effective TUI enablement from CLI/config
   - terminal output format
   - TTY stdin
   - TTY stdout
3. If enabled, create a dashboard, start it, and keep stats fresh with a 1-second interval.
4. Create an `AbortController` and map both `q` and `SIGINT` to a single idempotent cancellation path.
5. Pass loop callbacks (`onTaskStart`, `onIterationStart`, `onExperimentStart`, etc.) that translate runtime events into `appendOutput()` and `updateStats()` calls.
6. Always `stop()` and `destroy()` the dashboard in `finally`.

### Output streaming strategy

- **Pipeline:** uses `sdkSpawn()` directly so it can preserve pipeline-specific `logDir`, `mode`, MCP server config, usage, and fallback stdout/stderr handling. ACP events are rendered with `renderAcpEvent()` through an `acp.withAcpWriter()` bridge; tee'd stdout/stderr are line-buffered and appended if ACP events are missing or incomplete.
- **Ralph / Experiment:** use `sdkSpawn.autonomous()` inside `acp.withAcpWriter()` and pass `useStdin: true` so large prompts do not rely on argv length limits.
- **All three:** tag every emitted line with the active stage before appending it to the dashboard. Errors go to `kind: "error"`; human-readable stream output goes to `kind: "tool"`.

### Edge cases

- Partial stdout/stderr chunks are buffered until a newline or flush so stage prefixes are not repeated mid-line.
- Cancellation is safe to request multiple times.
- Non-TTY runs, redirected output, and markdown/json output modes skip dashboard startup entirely.
- Pipeline preserves a fallback path when an agent emits no ACP events.
- Ralph and Experiment intentionally do not surface token counts yet because their loop callback contracts do not expose usage.

### Flags, env vars, config knobs

- New flags: `--tui` and `--no-tui` on `pipeline run`, `ralph run`, and `experiment run`.
- No new env vars.
- No new persisted config field in this iteration.
- Resolved: a per-command `tui: true` config knob was added (`pipeline.tui`, `ralph.tui`, `experiment.tui`) with env vars `POE_PIPELINE_TUI`, `POE_RALPH_TUI`, `POE_EXPERIMENT_TUI`. CLI `--tui` and `--no-tui` flags take precedence over config.

## 4. Interfaces and test plan

### Module boundaries

The new code is built around small CLI-local helpers, not new shared runtime APIs:

```ts
runPipelineWithDashboard(options: PipelineDashboardRunOptions): Promise<PipelineRunResult>
createPipelineDashboardRunAgent(options): PipelineRunOptions["runAgent"]

runRalphWithDashboard(options: RalphDashboardRunOptions): Promise<RalphRunResult>
createRalphDashboardRunAgent(options): RalphRunOptions["runAgent"]

runExperimentWithDashboard(options: ExperimentDashboardRunOptions): Promise<ExperimentRunResult>
createExperimentDashboardRunAgent(options): ExperimentRunOptions["runAgent"]
```

Shared contracts already existed and remain unchanged:

- loop callbacks from `@poe-code/pipeline`, `@poe-code/ralph`, and `@poe-code/experiment-loop`
- dashboard contract from `@poe-code/design-system`
- spawn helpers from `src/sdk/spawn.ts`

### Output contract

Every dashboard write uses the existing design-system `OutputItem` shape:

```ts
{ kind: "info" | "success" | "error" | "tool" | "status", text: string, ts: number }
```

Stats writes use the existing `DashboardStats` shape:

```ts
{ status, iterations, tokensIn, tokensOut, elapsedMs, currentAction? }
```

The only command-specific variation is how `iterations` and `currentAction` are derived.

### Automated tests

Add command-level tests, not loop-package tests:

- [src/cli/commands/pipeline-command.test.ts](../../src/cli/commands/pipeline-command.test.ts)
  - `--tui` routes pipeline progress through the dashboard.
  - `quit` aborts the run and sets exit code 130.
  - child-agent output and stderr are stage-tagged and appended.
- [src/cli/commands/experiment-ralph.test.ts](../../src/cli/commands/experiment-ralph.test.ts)
  - equivalent coverage for Experiment.
  - equivalent coverage for Ralph.

These tests mock the dashboard and spawn layers, so they stay fast and do not create files.

### Manual QA

- Run each command with `--tui` in a real terminal.
- Verify `q` cancels cleanly.
- Verify scroll/follow keys still work.
- Verify long child-agent output shows up in the left pane with stage tags.
- Capture screenshots with `npm run screenshot-poe-code -- <command>` for visual validation.

### Rollout / migration

No migration is required:

- feature is opt-in
- SDK contracts stay unchanged
- non-TTY behavior stays on the existing logger path

## 5. Code plan

### Files to change

- [src/cli/commands/pipeline.ts](../../src/cli/commands/pipeline.ts)
  - add `--tui`
  - add dashboard runner + stats formatting helpers
  - add stage-label formatting and ACP/stdout/stderr streaming helpers
- [src/cli/commands/ralph.ts](../../src/cli/commands/ralph.ts)
  - add `--tui`
  - add dashboard runner for iteration callbacks
  - add ACP writer + stderr tee integration for child-agent output
- [src/cli/commands/experiment.ts](../../src/cli/commands/experiment.ts)
  - add `--tui`
  - add dashboard runner for experiment/baseline/metric/reset/commit callbacks
  - add ACP writer + stderr tee integration for child-agent output
- [src/cli/commands/pipeline-command.test.ts](../../src/cli/commands/pipeline-command.test.ts)
  - cover dashboard happy path, quit path, and streamed child output
- [src/cli/commands/experiment-ralph.test.ts](../../src/cli/commands/experiment-ralph.test.ts)
  - cover dashboard happy path, quit path, and streamed child output for Ralph + Experiment

### Build order

1. Wire `pipeline run --tui` first because it exercises the richest callback surface and token accounting.
2. Reuse the same dashboard lifecycle pattern for `ralph run`.
3. Apply the pattern to `experiment run`, adding experiment-specific status lines.
4. Add command tests for each integration path.
5. Do manual screenshot QA for all three commands.

### Follow-up candidates

- ~~Consider a persisted config knob only if interactive users ask for it repeatedly.~~ Done — `tui` config knob shipped in round 20.
