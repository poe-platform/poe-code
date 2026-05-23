---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: normalize-agent-eval-traces
    title: Normalize agent-eval execution traces
    prompt: >
      In `packages/agent-eval`, introduce a stable normalized trace model used
      by

      evaluation logic instead of inspecting provider-shaped `SpawnEvent`
      objects

      ad hoc. Add narrowly scoped source files under

      `packages/agent-eval/src/run/trace/` for the trace types and event

      normalization, and export only the public types/functions needed by the

      package from `packages/agent-eval/src/index.ts`.


      The normalized model must preserve enough evidence for deterministic

      evaluation of coding-agent behavior: ordered message/tool/usage/error

      events; tool name and normalized operation kind (`read`, `search`, `exec`,

      `edit`, `write`, `mcp`, or `other`); raw arguments when present;
      referenced

      file paths; timestamps or sequence ordering; usage totals; and tool

      completion/error outcome where emitted by the underlying ACP stream.

      Normalization must accept the existing ACP forms already consumed in this

      package (`event: "tool_start"` and `sessionUpdate: "tool_call"`) without

      provider-specific branching elsewhere in `agent-eval`.


      Preserve raw `events.jsonl` artifacts for debugging, but add a normalized

      trace artifact such as `trace.json` or `trace.jsonl` from

      `packages/agent-eval/src/run/result-writer.ts`. Future budget, cheating,

      metric, and judge code must consume the normalized trace representation.


      Follow TDD: add unit tests for normalization before implementation,

      including read/search/exec/edit/write/MCP calls, locations and raw-input

      paths, usage records, malformed events, ordering, and tool failures. Use

      in-memory filesystem patterns already present where artifacts are tested.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: capture-orchestrated-run-events
    title: Capture traces for every plan kind
    prompt: |
      Fix `packages/agent-eval/src/run/run.ts` and the relevant orchestration
      integration boundaries so `runEval()` receives observable nested agent
      events for all supported plan kinds: `plan`, `pipeline`,
      `superintendent`, and `experiment`.

      The current node dispatch path in
      `packages/agent-eval/src/run/run.ts#createNodeStreamSpawn` intentionally
      returns `emptyEvents()`, which means orchestrated evaluations currently
      produce no usable trace, usage, iteration counts, budget events, or
      anti-cheat evidence. Do not solve this by parsing decorative terminal
      output. Use the existing injectable runner/spawn seams in the owning
      packages, such as `PipelineRunOptions.runAgent`, and the corresponding
      superintendent/experiment execution seams; minimally extend those public
      interfaces only if needed to forward the same ACP events used by direct
      plan runs.

      Keep the CLI using SDK/package APIs rather than duplicating orchestration
      logic in the CLI. Preserve existing behavior of each plan kind while
      forwarding agent events into `agent-eval`'s normalized trace and raw event
      artifact. No provider-specific branches may be added to `agent-eval`.

      Follow TDD: add integration coverage proving each plan kind records
      non-empty tool and usage evidence when its mocked nested agent emits ACP
      events, and proving budget and anti-cheat consumers receive events for
      orchestrated runs rather than only direct `plan` runs.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: repair-run-lifecycle-and-artifacts
    title: Repair run lifecycle and judge artifacts
    prompt: |
      Repair evaluation lifecycle correctness in
      `packages/agent-eval/src/run/run.ts`,
      `packages/agent-eval/src/run/budget.ts`,
      `packages/agent-eval/src/run/result-writer.ts`, and
      `packages/agent-eval/src/run/judge.ts`.

      The judge currently receives an `eventsJsonlPath` before
      `events.jsonl` is written. Change the lifecycle so raw and normalized
      trace evidence needed by the judge exists before judge execution, while
      the final atomic artifact write still leaves a consistent completed run
      directory. The judge must consume normalized trace evidence, not depend
      on provider-shaped logs.

      Treat the configured run budget as the evaluated agent/workflow execution
      budget: add an explicit completion/finalization method to
      `BudgetEnforcer` that clears the wall timer after dispatch has completed
      and freezes the execution snapshot before scorer and judge phases begin.
      A budget trip during dispatch must still abort the executing agent and
      skip judge scoring, while a scorer or judge duration must not later
      retroactively turn an otherwise completed agent execution into
      `budget_exceeded`.

      Ensure errors in scorer/judge/artifact stages result in persisted,
      inspectable run evidence whenever a run directory already exists, instead
      of leaving only an exception for matrix-level wrapping.

      Follow TDD: cover judge artifact availability, budget finalization before
      scorer/judge work, wall-clock trips during dispatch, and partial artifact
      persistence when post-dispatch evaluation fails.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: correct-verdict-and-score-semantics
    title: Correct verdict and score semantics
    prompt: >
      Fix result semantics in `packages/agent-eval/src/run/run.ts`,

      `packages/agent-eval/src/types.ts`,
      `packages/agent-eval/src/aggregate.ts`,

      and report formatting/tests under `packages/agent-eval/src/report/`.


      A failed or aborted agent/workflow execution must never be reported as

      `pass` merely because one or more oracle assertions happen to pass.

      Preserve the priority of cheating and execution-budget failures, then

      classify dispatch/scorer/judge/framework failures as `error`, and only

      classify a completed valid execution as `pass` or `fail` from its

      required evaluation results.


      Correct weight behavior when a scoring component is intentionally disabled

      or skipped. In particular, `--no-judge` or a legitimately unavailable

      optional judge must not cap a perfect deterministic result at the tests

      weight (for example `0.7` under a `0.7/0.3` configuration). Normalize

      active component weights at evaluation time or record an explicit scoring

      policy that gives equivalent behavior. A required metric that fails or

      cannot execute must remain visible as failure/error; it must not be

      silently removed from the denominator.


      Add result metadata sufficient for reports to distinguish configured,

      executed, skipped, failed, and disabled scoring components. Update table

      and Markdown reports without removing existing correctness, test, token,

      cost, duration, and verdict information.


      Follow TDD: add unit/integration cases for dispatch error plus partial

      oracle pass, disabled judge with nonzero configured weight, judge skipped

      because of cheating/budget, scorer error, metric execution error, and

      aggregates containing skipped versus executed components.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: harden-anti-cheat-from-normalized-trace
    title: Detect outside-clone mutation and tool access
    prompt: |
      Replace the raw-event-only anti-cheat inspection in
      `packages/agent-eval/src/run/cheat.ts` with checks over the normalized
      trace introduced for `agent-eval`. Preserve the existing
      `outside-clone` reporting behavior while covering all file-affecting
      operations available in the trace, including reads, searches/globs,
      command executions with identifiable filesystem targets, edits, writes,
      and MCP file operations.

      Do not classify ordinary executable lookup such as `/usr/bin/env` as
      cheating, and retain explicit safe runtime/cache allowances needed to run
      tools. Do not falsely treat a command executable token as proof that every
      path referenced later in arbitrary shell syntax was checked: either
      normalize structured path evidence from tool arguments or mark the
      operation as uninspectable evidence in the trace/result for later report
      visibility. Prefer correct visibility over pretending shell commands are
      fully statically audited.

      Update `CheatReport` types and artifacts only where needed to distinguish
      confirmed violations from uninspectable file-affecting actions. Any
      confirmed outside-clone mutation must force a `cheated` verdict and zero
      correctness.

      Follow TDD: add edit/write/MCP outside-clone violation tests, allowed
      inside-clone writes, structured command argument checks, uninspectable
      shell command reporting, and orchestrated-plan integration coverage.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: add-declarative-trace-metrics
    title: Add declarative trace-derived metrics
    prompt: |
      Add P0 named metrics to `packages/agent-eval` using the reliable
      normalized trace and repaired lifecycle:
      `task_completion`, `plan_adherence`, `tool_correctness`, and
      `step_efficiency`.

      Extend `packages/agent-eval/src/schema.ts`,
      `packages/agent-eval/src/types.ts`,
      `packages/agent-eval/src/source/registry.ts`, and init/lint/check
      behavior so `eval.yaml` can declare metrics with a metric identifier,
      enabled/required status, score weight, pass threshold, and evaluator
      configuration. Keep definitions declarative and avoid provider-specific
      branches. Deterministic oracle test scoring remains authoritative for
      repository correctness and cannot be overridden by model-judged metrics.

      Implement a metric execution module under
      `packages/agent-eval/src/run/metrics/` with a stable result contract:
      metric id, score from `0` to `1`, threshold, passed state, execution
      status, human-readable reason, and supporting trace references when
      possible. Reuse existing judge-agent infrastructure for judge-backed
      metrics without collapsing all dimensions into a single anonymous mean.
      Use deterministic implementations where trace facts are sufficient;
      judge-backed implementations must receive the task, oracle outcome, and
      normalized trace.

      Model the useful DeepEval behavior (named score, threshold, reason, and
      agent-oriented dimensions) without importing its Python runtime or
      general conversational/RAG feature set. Preserve backward compatibility
      for existing eval definitions by translating the current `judge.rubric`
      and `weights` behavior or supplying an explicit migration/default policy.

      Follow TDD: schema and loading tests, deterministic metric tests, mocked
      judge-backed metric tests, threshold/required/disabled/error semantics,
      existing-eval backward compatibility, and an end-to-end fixture showing
      tests plus named metrics in `result.json`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: report-metrics-and-regressions
    title: Report evidence and behavior metrics
    prompt: |
      Extend aggregate and report surfaces in
      `packages/agent-eval/src/aggregate.ts`,
      `packages/agent-eval/src/report/load.ts`,
      `packages/agent-eval/src/report/format.ts`,
      `packages/agent-eval/src/report/render-table.ts`,
      `packages/agent-eval/src/report/render-md.ts`, and the existing eval CLI
      wrappers so users can inspect named metric outcomes and evaluator
      integrity evidence after a run or matrix.

      Report, at minimum, per-run/per-cell oracle correctness, named metric
      scores and pass state, skipped/error metric status, cheat violations or
      uninspectable risky actions, trace availability, execution error status,
      token/cost/duration totals, and existing verdict information. Keep the
      terminal summary compact; put detailed reasons and trace evidence into
      Markdown output or an additional detail rendering rather than making the
      default table unreadable.

      Add baseline/regression comparison only for already-recorded numeric
      dimensions: oracle correctness, named metric scores, duration, tokens,
      and cost. It must compare two result collections supplied locally and
      identify deltas/regressions; it must not add hosted persistence, synthetic
      datasets, or a broad benchmark registry.

      Update package documentation in `packages/agent-eval/README.md` only if
      the user grants README permission before implementation; otherwise leave
      README edits out and document the pending update in the implementation
      handoff.

      Follow TDD: aggregation tests, report snapshots, result loading tests,
      CLI parsing/output tests, baseline comparison tests, and ad hoc CLI
      screenshot validation with `npm run screenshot-poe-code -- <affected
      eval command>` for visual output changes.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: validate-agent-eval-p0
    title: Validate complete agent-eval P0 behavior
    prompt: |
      Validate the completed `agent-eval` integrity and trace-metrics work as a
      whole. Do not add unrelated features or work around failures.

      Run the targeted package tests for `@poe-code/agent-eval`, plus any
      directly changed orchestration package tests required by modifications to
      `packages/pipeline`, `packages/superintendent`, or
      `packages/experiment-loop`. Run builds/typechecks/lint commands already
      configured for affected packages or the workspace. Exercise one direct
      `plan` eval and one orchestrated eval kind through the supported
      development CLI flow, proving both emit normalized trace evidence and
      correctly calculate metrics and verdicts. Run screenshot validation for
      every changed visual eval-report/check/run output.

      Confirm the repaired cases explicitly: judge sees existing trace evidence,
      execution errors cannot pass, disabling judge does not penalize active
      score, wall-clock budget stops affecting post-dispatch evaluation, and
      outside-clone writes/edits are detected. Keep all relevant implementation
      plan changes and tests in the conventional commit(s); never blanket-stage
      unrelated working tree changes.
    status:
      test: done
      commit: done
name: agent-eval-integrity-and-trace-metrics
state: archived
---

# Context

`@poe-code/agent-eval` already has the right coding-agent foundation: cloned
repositories, deterministic oracle tests, plan/workflow dispatch, budgets,
anti-cheat reporting, optional agent-as-judge scoring, result artifacts, and
matrix reports. The P0 work preserves that model while making its evidence and
scores reliable enough to compare agents.

Confirmed integrity defects in the current implementation:

- `packages/agent-eval/src/run/run.ts#createNodeStreamSpawn` emits no events for
  `pipeline`, `superintendent`, or `experiment`, so their evidence-dependent
  evaluation is currently empty.
- `runEval()` passes an `events.jsonl` path to `judgeRun()` before
  `writeRunArtifacts()` creates that file.
- `resolveVerdict()` can classify a failed dispatch as `pass` when some oracle
  cases pass.
- `calculateCorrectness()` penalizes `--no-judge` runs when configured judge
  weight remains nonzero.
- `BudgetEnforcer` keeps its wall-clock timer active while scorer and judge
  phases execute.
- `CheatFilter` handles reads/searches/commands but not edit/write evidence
  already represented in agent event streams.

The feature direction borrows DeepEval's named agent-oriented metric outcomes
(`score`, `threshold`, `reason`) and OpenAI Evals' emphasis on reusable,
inspectable evaluation records, without importing either framework or replacing
Poe Code's repository-based evaluation behavior.
