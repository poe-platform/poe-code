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
    and request owner review when the board is complete.

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
  round: 5
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

- **Opt-in via flag or config.** Dashboard is off by default. Enable per-run with `--tui`, or persistently via a `tui: true` config setting (CLI flag wins over config). Non-TTY runs (CI, pipes, redirects) skip the dashboard automatically via the existing `resolveOutputFormat()` check inside `createDashboard`, even when enabled.
- **Only `quit` + scroll are wired.** `edit`, `pause`, `retry` are not hooked up — they have no agreed semantics per loop yet and are out of scope here. The footer should only show hints for commands that are actually wired. If this requires a small dashboard-side change to suppress unwired hints (rather than relying on every integrator to curate their own `hints` array), that change is in scope for this plan.
- **Stream child-agent output into the dashboard via the ACP pipeline.** The dashboard is useless if the left pane only shows `builder starting` / `builder completed` bookends while an agent runs for minutes. Don't tee raw child stdout — CLI agents like `codex` and `claude-code` emit JSON lines, not colored text. Instead, reuse the existing ACP rendering pipeline:
  1. Spawn agents through `spawnAutonomous` from `@poe-code/agent-spawn` (wraps `spawnStreaming` + `renderAcpStream` with activity-timeout retry).
  2. Bind a dashboard-targeted `AcpLineWriter` with `acp.withAcpWriter(writer, fn)` from `@poe-code/design-system` around the call. `renderAcpStream` → `renderAgentMessage` / `renderToolStart` / `renderReasoning` / `renderUsage` / `renderError` already emit chalk-styled human-readable lines; the writer forwards each one into `dashboard.appendOutput` (kind `tool` for stdout-ish, `error` for errors).
  3. The dashboard's ANSI parser renders chalk's escape codes as per-segment colors — no custom JSON-to-pretty formatter needed.
  4. Stderr is streamed separately through `spawnStreaming`'s `tee.stderr` option into `appendOutput` with `kind: "error"`.
  5. Append each line with a stage tag (`builder`, `inspector:<name>`, `superintendent`, `owner`, or the loop-specific equivalent).
  6. Pass prompts via `useStdin: true` so large templated prompts don't hit `E2BIG`.
  7. In non-TTY fallback mode, leave `renderAcpStream` pointed at its default writer (stdout) so the existing logger path still works.

  The superintendent integration is the reference implementation: see [packages/superintendent/src/commands/run.ts](../../packages/superintendent/src/commands/run.ts) → `createAgentRunner` (line buffering + stage tagging), `executeSpawnAgentStreaming` (the `withAcpWriter` + `spawnAutonomous` wiring), and the `AgentRunInput.onStdout` / `onStderr` hooks in [packages/superintendent/src/runtime/loop.ts](../../packages/superintendent/src/runtime/loop.ts).

## Task Board

- [ ] Finish the feature plan (altitudes 2–5).
- [x] Integrate dashboard into pipeline.
- [x] Integrate dashboard into ralph.
- [x] Integrate dashboard into experiment.
- [ ] Stream child-agent output into `appendOutput` from the pipeline integration (route `spawnAutonomous` via `acp.withAcpWriter`, stage-tagged, prompts via stdin).
- [ ] Stream child-agent output into `appendOutput` from the ralph integration (route `spawnAutonomous` via `acp.withAcpWriter`, stage-tagged, prompts via stdin).
- [ ] Stream child-agent output into `appendOutput` from the experiment integration (route `spawnAutonomous` via `acp.withAcpWriter`, stage-tagged, prompts via stdin).
