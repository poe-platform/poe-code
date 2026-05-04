---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: sandbox-local-workspace-path
    title: Upload workspace to a sandbox-local path, not the host cwd
    prompt: |
      In packages/runner-e2b/src/opened-env.ts, the workspace upload uses
      input.spec.cwd (the host's cwd, e.g. /Users/kjopek/Workspace/poe-code)
      as the destination directory inside the sandbox. For bases that
      run as a non-root user (like e2b/claude-code) this fails with a
      permission error on `mkdir -p /Users/...`, and even where it
      succeeds it bakes the host's path layout into every sandbox.

      Introduce a sandbox-local destination - default to /workspace -
      and translate paths so:
        - uploadWorkspace tars from input.spec.cwd on the host but
          extracts to the sandbox path inside the sandbox.
        - downloadWorkspace mirrors the same translation in reverse.
        - exec(spec) runs with `cwd` mapped to the sandbox path when
          spec.cwd matches the host workspace root, and uses spec.cwd
          unchanged for other paths (so callers can still target
          absolute sandbox paths directly).

      Make the sandbox path configurable via runtime.workspace_dir on
      E2bRuntime (default "/workspace"). Project config / Dockerfile
      resolution must keep using the host cwd - only the runtime side
      of the boundary changes.

      The integration test in packages/runner-e2b/src/e2b-execution-env.integration.ts
      currently hides this bug by using mkdtemp; add an integration
      assertion that the sandbox path differs from the host cwd and
      uploads still round-trip.
    status:
      implement: done
      test: done
      commit: done

  - id: runRemoteOrThrow-error-tail
    title: Surface failing command and stderr from runRemoteOrThrow
    prompt: |
      In packages/runner-e2b/src/opened-env.ts the runRemoteOrThrow
      helper does `await sandbox.commands.run(command)` and then
      `if ("exitCode" in result && result.exitCode !== 0) throw ...`.
      The e2b SDK's CommandHandle.wait throws a CommandExitError for
      any non-zero exit before the helper sees a result, so the
      `exitCode !== 0` branch is unreachable and users get the bare
      "exit status 1" with no command and no stderr.

      Wrap the call so we always capture stdout and stderr (via the
      onStdout/onStderr callbacks the e2b SDK exposes), catch the
      CommandExitError thrown by .wait(), and rethrow a new Error
      whose message includes the failing command and a trailing tail
      of stderr (matching the pattern used by
      packages/runner-e2b/src/template-build.ts's decorateBuildError).
      Cap the tail at ~30 lines so we don't dump megabytes.

      Add a unit test that mocks sandbox.commands.run to throw a
      CommandExitError and asserts the rethrown message contains the
      command and stderr tail.
    status:
      implement: done
      test: done
      commit: done

  - id: configure-on-spawn
    title: Run poe-code configure inside the sandbox before each spawn
    prompt: |
      Sandbox images install agents (claude-code, codex, opencode) but
      their config files don't route through Poe yet, so spawned agents
      hit anthropic.com / openai.com directly. POE_API_KEY is already
      propagated to the sandbox env via src/sdk/spawn.ts, so configure
      can authenticate non-interactively through hasProviderEnvCredential.

      Add a configure-on-spawn step in packages/runner-e2b (or whichever
      runner-side hook fires after sandbox.create and before the agent
      exec, e.g. inside opened-env.uploadWorkspace's caller in
      packages/agent-harness-tools/src/run-poe-command.ts) that runs:
        - First, the provider's binary-exists check from
          src/providers/<agent>.ts inside the sandbox. This is the
          createBinaryExistsCheck call already in each provider file.
        - If the binary is present, run `poe-code configure --yes
          --provider poe <agent>` inside the sandbox.
        - If the binary is missing, skip silently. Do not fail the
          spawn just because the image lacks an unrelated agent.

      Configure must be idempotent end-to-end: a second spawn of the
      same agent in a paused/restarted sandbox should be a no-op (no
      mutations reported by configure-payload). If today's configure
      always rewrites the file, add a `--skip-if-configured` shortcut
      that compares the current config payload to what configure
      would emit and exits zero before any write.

      Test with a real sandbox spawning claude-code through e2b and
      asserting the agent talks to api.poe.com (e.g. via
      `claude --version` followed by a one-shot prompt that succeeds).
    status:
      implement: done
      test: done
      commit: done

  - id: e2b-spawn-end-to-end
    title: Make `spawn <agent> --runtime e2b` work end-to-end against an ephemeral
      sandbox
    prompt: |
      With tasks 1-3 landed, wire and verify the spawn-through-e2b
      path against a real e2b sandbox. The previous three tasks are
      the structural fixes; this task is the integration glue and
      the verification.

      Smoke-test the path with `--runner-sync none` so sandbox writes
      never sync back into the poe-code repo. The image/template should
      already contain the tiny fixture files needed by the prompt:
      README.md (one paragraph) and hello.txt (one line).
      The agent's prompt should ask it to read hello.txt and reply
      with one short sentence.

      Acceptance commands, all green from a clean state:
        npm run dev -- runtime build --runtime e2b
        npm run dev -- --yes spawn claude-code "read hello.txt and \
          summarize in one sentence" --runtime e2b --runner-sync none
        npm run dev -- --yes spawn claude-code "write SYNC_CHECK.txt \
          containing synced" --runtime e2b --runner-sync both --cwd <tmpdir>

      The spawn must:
        - Reach the sandbox without permission errors on the upload.
        - Auto-configure claude-code inside the sandbox via task 3.
        - Hit api.poe.com (verifiable via the request log or a
          throwaway POE_API_KEY tied to a fresh account).
        - Return non-empty stdout with exit code 0.
        - Write nothing back to the poe-code repo in the smoke-test variant.
        - Sync SYNC_CHECK.txt back to the tmpdir in the explicit sync variant.

      Add a vitest integration test that drives the same flow but
      against a captured-sandbox fake when E2B_API_KEY is unset, so
      CI exercises the wiring even without real e2b access.
    status:
      implement: done
      test: done
      commit: done

  - id: e2b-ralph-end-to-end
    title: Make `ralph run --runtime e2b` work end-to-end on a fake plan
    prompt: |
      Once basic spawn through e2b works (previous task), verify the
      ralph iteration loop on top of it.

      Use `--runner-sync none` for the smoke test so the run can target
      an ephemeral sandbox without tmpdir setup or cleanup. The plan is
      a one-task ralph markdown doc whose prompt is intentionally
      trivial - e.g. "Report the current iteration number and stop after
      2 iterations". Keep a separate sync assertion for the workspace
      write path.

      Acceptance commands, all green from a clean state:
        npm run dev -- ralph init docs/plans/e2b-ralph-smoke.md \
          --agent claude-code --iterations 2
        npm run dev -- --yes ralph run docs/plans/e2b-ralph-smoke.md \
          --runtime e2b --runner-sync none
        npm run dev -- --yes ralph run <tmpdir>/plan.md \
          --runtime e2b --runner-sync both --cwd <tmpdir>

      The run must:
        - Open one e2b sandbox, reuse it across both iterations.
        - Avoid host workspace writes in the smoke-test variant.
        - Sync the workspace back between iterations in the explicit
          sync variant so ralph sees ITERATIONS.txt grow.
        - Stop after 2 iterations as configured.
        - Leave the poe-code repo untouched except for the smoke plan
          doc created by `ralph init`.

      Document the recommended `--runner-sync none` smoke-test flow
      and the separate tmpdir-only sync assertion in
      packages/ralph/README.md so future contributors don't aim
      sync-back runs at the parent repo.
    status:
      implement: done
      test: done
      commit: done

  - id: runner-sync-flag
    title: Add a --runner-sync flag to control workspace upload/download
    prompt: |
      Today every non-host runtime spawn implicitly does an upload on
      open and a download on close, with conflict resolution governed
      by runtime.runner.download_conflict in config. There is no way
      to opt out of either side without editing config, which means
      casual experiments either pollute the host workspace via
      sync-back or force users to mkdtemp every test.

      Add a CLI option to packages/agent-spawn (and the runtime
      command group) with the working name --runner-sync, exposing
      one of these modes:
        - both    (default; current behavior, upload + download)
        - upload  (upload host workspace into the sandbox, skip the
                   sync-back so sandbox writes never touch the host)
        - none    (skip upload and download; the sandbox runs against
                   whatever the image already contains)

      Wire it as an override over runtime.runner in
      packages/poe-code-config/src/runtime.ts (add a new
      runner.sync field with the same enum), thread it through
      addRuntimeOptions / pickRuntimeOptions in
      src/cli/commands/runtime-options.ts, and have
      packages/runner-e2b/src/opened-env.ts honor it in
      uploadWorkspace / downloadWorkspace (early-return when the
      mode says skip).

      Tasks 4 and 5 (spawn / ralph end-to-end) get noticeably
      simpler with --runner-sync none: no mkdtemp, no finally
      cleanup, just run against an ephemeral sandbox. Update those
      tasks' acceptance commands to use --runner-sync none for the
      smoke-test variants, while keeping a separate "with sync"
      assertion that verifies download still works when requested.
    status:
      implement: done
      test: done
      commit: done
---

# Context

Tested e2b spawn end-to-end against the new `e2b/claude-code`-based template (`mxyf0ooulpfwdzo14x64`) and uncovered four blockers. Items 1 and 2 from the original list collapse into a single task because they share a root cause (host `cwd` leaking into the sandbox path). Items 3 and 4 are independent and surfaced once 1+2 were diagnosed.

## Why now

`spawn <agent> --runtime e2b` looks like the headline feature, but it has never worked outside the integration test, which dodges issue 1 by using `mkdtemp`. Until these are fixed, the only paths exercised in real use are `runtime build`, `runtime templates ls`, and host-runtime spawns.

## Out of scope

- Per-sandbox memory/cpu overrides (tied to e2b's template-level memoryMB; separate redesign).
- Workspace exclusion glob extensions for the build context walker (existing default exclusions are sufficient for the spawn-time upload).
- Reintroducing goose / kimi to the sandbox image.

## Acceptance

`POE_API_KEY=… npm run dev -- spawn claude-code "say hi" --runtime e2b` returns a Poe-routed response with no error log entries, on a fresh checkout where the e2b template was built but no spawn has run before.
