---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: session-skip-per-iteration-download
    title: Make PoeCommandSession skip per-iteration workspace download
    prompt: >
      Today `createPoeCommandSession`
      (packages/agent-harness-tools/src/run-poe-command.ts)

      keeps a single sandbox alive across `session.run(...)` calls and uploads

      the workspace once on the first run, but its `runSync` helper still calls

      `env.downloadWorkspace(...)` after every handle exits. Against e2b/docker

      that means each iteration round-trips the whole tar archive even though

      the sandbox itself is reused. The user goal is "kick off the harness, walk

      away" — between-iteration downloads are wasted bandwidth and add the only

      remaining silent pause in the loop.


      Change `session.run(openSpec, signal?)` to accept a third arg

      `{ syncBack?: boolean }` (default `false`). When `syncBack` is `false`,

      pass a flag through to `runSync` that skips the post-exit

      `downloadWorkspace` call. The session must still surface the agent's

      stdout/stderr/exitCode the same way.


      Add `session.syncBack(): Promise<DownloadResult>` so callers can pull the

      workspace back on demand (e.g. on Ctrl-C, before close, or between

      iterations that need host-side files). Keep `session.close()` doing a

      final `downloadWorkspace` followed by `env.close()`. If `syncBack()`

      already ran and nothing changed, `close()` should still be safe to call

      (idempotent — gate on whether a download already happened since the last

      run).


      Update or extend `runPoeCommand` so the existing single-shot path keeps

      its current behavior (download every call, close every call).


      The runner-e2b factory must keep emitting `workspace-download:start` /

      `workspace-download:end` events from the spinner work that just shipped.

      Don't fire spurious download events when `syncBack` is false.
    status:
      implement: done
      test: done
  - id: spawn-session-primitive
    title: Add createSpawnSession primitive to agent-spawn + SDK
    prompt: |
      Add `createSpawnSession` to `packages/agent-spawn` (new file
      `src/spawn-session.ts`, re-exported from the package index). Signature:

        createSpawnSession(options: {
          service: string;
          cwd?: string;
          runtime?, runtimeImage?, runtimeTemplate?, runtimeConfigCwd?,
          mountPoeCode?, runnerSync?,
          mode?, mcpServers?, model?, signal?, onProgress?, ...
        }): {
          run(input: { prompt: string; agent?: string; model?: string;
                       cwd?: string; signal?: AbortSignal;
                       syncBack?: boolean }): Promise<SpawnResult>;
          syncBack(): Promise<DownloadResult>;
          close(): Promise<void>;
        }

      Internals: call `resolvePoeCommandExecution` once with the constructor
      options to get a factory + base openSpec + state, then
      `createPoeCommandSession({ factory, state })`. Each `run(...)` builds a
      per-call openSpec by deep-merging the base openSpec with prompt/agent/
      model/cwd overrides (use `buildSpawnArgs` from agent-spawn to render the
      argv for the chosen agent). Pass `onProgress` from the constructor
      through every openSpec so the spinner driver in src/cli/commands/spawn.ts
      keeps working unchanged.

      Detach is incoherent with sessions (one sandbox can't host N detached
      jobs and stay attached). When constructor opts include `detach: true`,
      throw at construction time with a message pointing the caller to plain
      `spawn(...)`.

      Mirror the primitive at `src/sdk/spawn-session.ts` as a thin re-export
      (matches the existing src/sdk/spawn.ts wrapping pattern). Keep src/sdk
      logic-free per CLAUDE.md ("core should be lightweight and only wire
      packages and expose public apis").

      Reference and consolidate the existing `createReusableE2bRalphRunner` in
      src/sdk/ralph.ts — that helper already opens once with
      `createPoeCommandSession`, but only fires when no custom `runAgent` is
      passed (which the CLI always does, so the helper is dead in practice).
      The new primitive replaces it; delete the duplicate code path once
      task `wire-ralph-cli-session` lands.
    status:
      implement: done
      test: done
  - id: wire-ralph-cli-session
    title: Wire ralph CLI to one runtime session for the whole loop
    prompt: |
      `src/cli/commands/ralph.ts` builds a per-iteration `runAgent` that calls
      `sdkSpawn.autonomous(...)` (around line 107). Each call goes through
      `runPoeCommand` and spins up a fresh sandbox / re-uploads the workspace.
      For e2b especially, this is the silent-pause pile-up the user is hitting.

      Replace the per-iteration spawn with one `createSpawnSession(...)` opened
      before `runRalph(...)` is called and closed in a `finally` after it
      returns. The session's runtime opts come from the CLI flags
      (`runtimeOptions` plus `runtimeConfigCwd: container.env.cwd`). The
      dashboard `runAgent` (around `createRalphDashboardRunAgent`) becomes a
      thin shim that calls `session.run({ agent, prompt, model, cwd, signal })`
      and translates the result for the dashboard.

      Honor `--detach`: if the user passed `--detach`, skip the session
      entirely and use the existing one-shot autonomous spawn path. Sessions
      and detach are mutually exclusive (the SDK primitive throws on this
      combo).

      Default `syncBack` to `false` for normal iterations. After the last
      iteration completes (or on cancellation / fatal error), call
      `session.syncBack()` once before `session.close()` so the user's local
      tree reflects the final sandbox state. The host-side frontmatter writes
      ralph already does (status: completed/open/failed) keep working — they
      run AFTER the session.close(), so they see the synced files.

      Delete the now-dead `createReusableE2bRalphRunner` path in
      `src/sdk/ralph.ts` and route the SDK `runRalph` through the new session
      primitive too.
    status:
      implement: done
      test: done
  - id: wire-superintendent-session
    title: Wire superintendent to one runtime session per run
    prompt: |
      `packages/superintendent/src/runtime/agent-runner.ts` calls
      `runPoeCommand` (line 122) on every agent invocation. Across a multi-role
      superintendent run that's N fresh sandbox boots and N workspace
      uploads/downloads — same problem as ralph.

      Convert `agent-runner.ts` to take a session via input rather than
      constructing its own factory + openSpec. Define a small
      `AgentRunnerSession` interface in agent-harness-tools (re-export from
      package index) that exposes `run(openSpec)` and `close()` — superintendent
      depends on agent-harness-tools already, so no new dep. The session is
      created in `packages/superintendent/src/runtime/run-superintendent.ts`
      (or wherever the role loop is orchestrated) and passed down through the
      role/iteration plumbing.

      The session itself comes from the SDK primitive in the CLI layer
      (`src/sdk/superintendent.ts` or `src/cli/commands/...` — wherever
      superintendent is invoked). Run-superintendent stays inside
      `packages/superintendent` and accepts an injected session, keeping the
      package free of SDK imports.

      Default `syncBack: false` between role invocations. Force a final
      `syncBack()` then `close()` at the end of the run (and on cancel, in
      `finally`). Each role still gets its own openSpec (different agent,
      prompt, log path); only the runtime sandbox is shared.

      `runPoeCommand` stays untouched — superintendent's old code path is just
      no longer used.
    status:
      implement: done
      test: done
  - id: wire-experiment-session
    title: Wire experiment-loop to one runtime session with per-iteration sync
    prompt: |
      `src/cli/commands/experiment.ts` (`createExperimentDashboardRunAgent` /
      `createExperimentCliRunAgent`, around lines 255 / 298 / 762) and
      `src/sdk/experiment.ts` line 73 each iteration calls
      `sdkSpawn.autonomous(...)` directly — fresh sandbox every time.

      Replace with a single `createSpawnSession(...)` opened before the loop
      and closed in a `finally`. Both the dashboard and the CLI run-agent
      shapes funnel through `session.run(...)`.

      IMPORTANT: experiment-loop runs git operations on the host cwd between
      iterations (see `packages/experiment-loop/src/run/loop.ts` lines around
      390–500: `git.currentHash`, `git.reset`, journal commits keyed on
      `entry.commit`). With a long-lived sandbox, the agent's edits live
      inside the sandbox and the host tree is empty until something pulls it
      back. The host-side git steps would see stale state.

      Pass `syncBack: true` on every `session.run(...)` call from
      experiment-loop. The sandbox stays alive (saves boot cost — the only
      thing the user actually cares about here), but files round-trip on each
      iteration so the host git steps keep working unchanged. Document this
      in the experiment-loop README so future authors know not to remove it.

      No change needed to `packages/experiment-loop/src/run/loop.ts` itself —
      it accepts an injected `runAgent`, so swapping the CLI's runAgent
      implementation is enough.
    status:
      implement: done
      test: done
  - id: wire-pipeline-session
    title: Wire pipeline to one runtime session for the whole run
    prompt: |
      `src/cli/commands/pipeline.ts` has two runAgent factories
      (`createPipelineDashboardRunAgent` around line 366,
      `createPipelineCliRunAgent` around line 447) — both call `sdkSpawn(...)`
      or `sdkSpawn.autonomous(...)` per task. `src/sdk/pipeline.ts` has
      mirrored runAgent fallbacks (lines 111, 158). All of them spin up a
      fresh sandbox per task.

      Replace with a `createSpawnSession(...)` opened before the pipeline run
      starts (in `runPipelineWithDashboard` / `runPipeline` equivalents) and
      closed in a `finally`. Both runAgent shapes funnel through
      `session.run(...)`. Streaming events the dashboard relies on must keep
      flowing — `session.run` should expose stdout/stderr the same way the
      current spawn does (a streaming variant of `session.run` that returns
      `{ events, result }` like `spawn(...)` does today; reuse the underlying
      handle/streams).

      Default `syncBack: false` between tasks. Final
      `syncBack()` + `close()` after the last task. Pipeline doesn't run
      host-side git between tasks (commits happen via the agent's commit step
      inside the sandbox), so deferred sync is correct here.

      Mirror the change in `src/sdk/pipeline.ts` so SDK callers get the same
      behavior. Keep the existing `runAgent` override hook so users can plug
      a custom runner if they want to (it bypasses the session).
    status:
      implement: done
      test: done
  - id: document-session-semantics
    title: Document the session lifecycle in harness READMEs
    prompt: |
      Update the package READMEs to describe the new "one sandbox per harness
      run" lifecycle. Don't add unrelated content; one tight section per
      README. Touch:

      - packages/ralph/README.md — under a "Runtime sessions" or similar
        section: explain that a single sandbox is opened at the start of
        `ralph run` and reused across all iterations; workspace is uploaded
        once and synced back at the end (or on abort). Note `--detach` is
        incompatible with sessions and falls back to the one-shot path.
      - packages/superintendent/README.md — same shape: one sandbox per
        superintendent run, all roles share it.
      - packages/experiment-loop/README.md — one sandbox per experiment run,
        but workspace round-trips on every iteration because experiment-loop
        runs git on the host between iterations. Be explicit that this is
        intentional.
      - packages/pipeline/README.md — one sandbox per pipeline run, sync at
        end.

      Per CLAUDE.md "Keep the readme up to date but you are not allowed to
      add anything to readme without user's permission" — these additions
      ARE authorized by this plan; do not expand scope to unrelated sections.
    status:
      implement: done
state: archived
---

# Long-lived runtime session for harnesses

## Why

Today every iteration of every harness (ralph, superintendent, experiment, pipeline) calls `spawnAutonomous`, which goes through `runPoeCommand` and per-call does:

1. `factory.open(...)` — fresh sandbox boot
2. `env.uploadWorkspace()` — full tar of cwd
3. agent runs
4. `env.downloadWorkspace(...)` — full tar back
5. `env.close()` — sandbox killed

Against e2b, every iteration eats the cold-boot pause plus an upload and a download. The user's stated goal is to kick off a long harness run, close the laptop, and come back to a finished result — the per-iteration boot is the entire blocker.

## Current audit

- **ralph**: [src/cli/commands/ralph.ts:107](../../src/cli/commands/ralph.ts#L107) wires a custom `runAgent` to `sdkSpawn.autonomous(...)` per iteration — fresh sandbox every time. There is a partial `createReusableE2bRalphRunner` in [src/sdk/ralph.ts:58](../../src/sdk/ralph.ts#L58) that uses `createPoeCommandSession`, but the CLI always passes its own `runAgent` so the reusable path is dead.
- **superintendent**: [packages/superintendent/src/runtime/agent-runner.ts:122](../../packages/superintendent/src/runtime/agent-runner.ts#L122) calls `runPoeCommand` directly per agent invocation — fresh sandbox per role.
- **experiment**: [src/cli/commands/experiment.ts:267, :300, :762](../../src/cli/commands/experiment.ts) and [src/sdk/experiment.ts:73](../../src/sdk/experiment.ts#L73) call `sdkSpawn.autonomous(...)` per iteration. Constraint: experiment-loop runs git ops on the host cwd between iterations, so files must be on disk between iterations.
- **pipeline**: [src/cli/commands/pipeline.ts:380, :449](../../src/cli/commands/pipeline.ts) and [src/sdk/pipeline.ts:111, :158](../../src/sdk/pipeline.ts) call `sdkSpawn(...)` / `sdkSpawn.autonomous(...)` per task — fresh sandbox per task.

## Foundation that already exists

- `createPoeCommandSession` in [packages/agent-harness-tools/src/run-poe-command.ts:138](../../packages/agent-harness-tools/src/run-poe-command.ts#L138) — opens factory once, uploads once, exposes `run(spec)` for repeated calls. Sandbox stays alive; `close()` kills it.
- BUT `runSync` (line 357) still calls `downloadWorkspace` after every handle exits. So the session pattern as it stands saves the boot but not the per-iteration sync. Fixed by task `session-skip-per-iteration-download`.
- The progress-spinner work (commit `c201022c`) emits events for sandbox connect / template build / workspace upload / workspace download. Sessions must keep those events flowing for the existing spinner driver in [src/cli/commands/spawn.ts](../../src/cli/commands/spawn.ts).

## Decisions

- Session = one sandbox per harness run. All iterations / roles / tasks share it.
- Default sync semantics: upload once on first run, defer download to `session.close()`. Harnesses that need host-side files between iterations (only experiment-loop today, because of host git) opt into per-iteration sync via `syncBack: true`.
- `--detach` is incompatible with sessions. The SDK primitive throws on the combo; CLI flags fall back to the existing one-shot detach path.
- `createSpawnSession` lives in `packages/agent-spawn` (real logic) with a thin re-export at `src/sdk/spawn-session.ts` (CLAUDE.md: src/sdk is a wrapper, not a logic layer).
- Existing `createReusableE2bRalphRunner` in src/sdk/ralph.ts is deleted once ralph is wired to the new primitive — single shared path, no per-harness duplication (project memory: "Extend shared libs, don't duplicate").
- TDD per CLAUDE.md. Each task ships with unit tests. Existing fast-mock patterns in `packages/runner-e2b/src/factory.test.ts` and `packages/agent-spawn/src/agent-spawn.test.ts` are the model.
