---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: scaffold-agent-child-process-package
    title: Scaffold the agent-child-process package
    prompt: |
      Create a new isolated workspace package at `packages/agent-child-process`.

      Requirements:
      - Package name: `@poe-code/agent-child-process`.
      - TypeScript ESM package, matching nearby package conventions.
      - Export only the package root.
      - Add scripts for `build`, `test`, `test:unit`, and `lint`, matching local package style.
      - Add `@poe-code/agent-spawn` as the only Poe package dependency.
      - Do not depend on `@poe-code/process-runner`, `@poe-code/process-launcher`, `@poe-code/agent-defs`, or the top-level SDK package.
      - Do not add a CLI command.
      - Do not integrate this package into existing callers or top-level SDK exports.
      - Add `packages/agent-child-process/README.md` documenting that the package exposes no environment variables and listing all function options: `spawnProcess`, `runAgent`, `cwd`, `env`, `signal`, `rejectOnNonZeroExit`, `context`, and `onExit`.
      - Add the package to the repo workspace/package metadata required for local builds and tests.
    status:
      implement: done
      test: done

  - id: define-agent-child-process-public-api
    title: Define public API contracts and exports
    prompt: |
      In `packages/agent-child-process/src`, define and export the public API for a Node-like child process wrapper with agent follow-up support.

      Export these functions from `src/index.ts`:
      - `exec(command, options?)`
      - `execFile(file, args?, options?)`
      - `spawn(file, args?, options?)`

      Export these public types:
      - `SpawnProcess = typeof import("node:child_process").spawn`
      - `AgentChildProcessKind = "exec" | "execFile" | "spawn"`
      - `AgentChildProcessAttempt`
      - `AgentChildProcessFollowUp`
      - `AgentChildProcessResult`
      - `AgentChildProcessError`
      - `AgentExitPolicy`
      - `AgentChildProcessOptions`
      - `AgentChildProcessRunAgent`
      - `AgentChildProcessHandle`

      Required shape:
      ```ts
      export interface AgentChildProcessAttempt {
        kind: AgentChildProcessKind;
        command: string;
        args: string[];
        cwd?: string;
        exitCode: number;
        stdout: string;
        stderr: string;
      }

      export interface AgentChildProcessFollowUp {
        agent: string;
        model?: string;
        stdout: string;
        stderr: string;
        exitCode: number;
        threadId?: string;
        usage?: SpawnUsage;
        logFile?: string;
      }

      export interface AgentChildProcessResult extends AgentChildProcessAttempt {
        attempts: [AgentChildProcessAttempt];
        agent?: AgentChildProcessFollowUp;
      }

      export interface AgentExitPolicy {
        agent: string;
        model?: string;
        prompt: string;
        when?(attempt: AgentChildProcessAttempt): boolean | Promise<boolean>;
      }

      export interface AgentChildProcessOptions {
        spawnProcess?: SpawnProcess;
        runAgent?: AgentChildProcessRunAgent;
        cwd?: string;
        env?: Record<string, string>;
        signal?: AbortSignal;
        rejectOnNonZeroExit?: boolean;
        context?: string;
        onExit?: AgentExitPolicy;
      }
      ```

      Keep `agent` inside `onExit`; do not add a top-level `agent` option. Keep `onExit` as the only follow-up hook; do not add `onFailure`, `onSuccess`, automatic rerun, or output-rewrite options.
    status:
      implement: done
      test: done

  - id: implement-child-process-execution
    title: Implement exec, execFile, and spawn with node child_process
    prompt: |
      Implement command execution in `packages/agent-child-process` using `node:child_process.spawn` directly.

      Requirements:
      - `execFile(file, args, options)` calls `spawnProcess(file, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], signal })`.
      - `exec(command, options)` invokes the platform shell via `spawnProcess`.
        - POSIX: command is `process.env.SHELL ?? "sh"`, args are `["-c", command]`.
        - Windows: command is `process.env.ComSpec ?? "cmd.exe"`, args are `["/d", "/s", "/c", command]`.
      - Preserve the original shell command string in `AgentChildProcessAttempt.command`.
      - `spawn(file, args, options)` returns immediately with `pid`, `stdin`, `stdout`, `stderr`, `kill(signal)`, and `result`.
      - `exec`, `execFile`, and `spawn().result` capture stdout/stderr into strings.
      - `spawn` must still expose readable stdout/stderr streams to the caller while internal capture runs.
      - Non-zero command exits resolve by default.
      - When `rejectOnNonZeroExit: true`, reject with an `AgentChildProcessError` whose `result` is the same command result.
      - Pass `env` to `child_process.spawn` exactly as provided; do not merge it with `process.env`.
      - Respect `signal` for the child process.
      - Convert child process `error` events into failed attempts when possible; synchronous spawn errors should reject because no process attempt exists.
    status:
      implement: done
      test: done

  - id: implement-agent-follow-up
    title: Implement onExit agent follow-up
    prompt: |
      Implement the `onExit` follow-up flow in `packages/agent-child-process`.

      Requirements:
      - After a command exits, evaluate `options.onExit`.
      - If `onExit` is omitted, return the command result without spawning an agent.
      - If `onExit.when` exists and returns false, return the command result without spawning an agent.
      - If `onExit.when` throws or rejects, reject with a policy evaluation error that includes the command attempt.
      - If `onExit` matches, spawn the agent by calling `options.runAgent` when provided; otherwise call the default implementation backed by `@poe-code/agent-spawn`.
      - Pass `policy.agent` directly as the agent id to `runAgent`.
      - Pass `policy.model` directly as the model option when present.
      - Pass `options.cwd` and `options.signal` to the agent call.
      - Do not parse `agent:model` locally and do not depend on `@poe-code/agent-defs`.
      - Never branch on a specific provider name.
      - Attach the agent result separately as `result.agent`; do not overwrite command `stdout`, `stderr`, or `exitCode`.
      - If the agent exits non-zero, preserve that non-zero value under `result.agent.exitCode` and leave the command exit code unchanged.
    status:
      implement: done
      test: done

  - id: build-agent-follow-up-prompt
    title: Build structured prompts for follow-up agents
    prompt: |
      Add prompt construction for `onExit` agent follow-up in `packages/agent-child-process`.

      The final prompt sent to the agent must include:
      - The caller-provided `onExit.prompt`.
      - The command kind: `exec`, `execFile`, or `spawn`.
      - The command string/file and argv.
      - The cwd when provided.
      - The exit code.
      - The original stdout.
      - The original stderr.
      - Optional caller context from `options.context`.

      The prompt must clearly state that stdout/stderr are historical facts from the original attempt and must not be rewritten by the library. If the agent needs verification or a rerun, the agent should run commands itself.

      Do not add automatic rerun behavior. Do not add transform/rewrite output behavior.
    status:
      implement: done
      test: done

  - id: add-agent-child-process-tests
    title: Add focused unit and integration tests
    prompt: |
      Add tests for `packages/agent-child-process`.

      Unit tests must inject fake `spawnProcess` and `runAgent` functions. Do not call a real LLM and do not create files.

      Cover:
      - `execFile("npm", ["test"])` calls `spawnProcess("npm", ["test"], ...)`.
      - stdout/stderr capture from fake child streams.
      - non-zero exits resolve by default.
      - `rejectOnNonZeroExit: true` rejects with `AgentChildProcessError` containing the result.
      - `cwd`, `env`, and `signal` pass through to `spawnProcess`.
      - `exec("npm test")` maps to the platform shell and preserves the original command string.
      - `spawn()` returns the expected handle and delegates `kill(signal)` to the underlying child process.
      - no `onExit` means no agent call.
      - `onExit` without `when` calls injected `runAgent`.
      - `when` returning false skips the agent.
      - async `when` is supported.
      - throwing/rejecting `when` produces a policy evaluation error.
      - `policy.agent` and `policy.model` pass to `runAgent`.
      - agent non-zero exit is attached under `result.agent.exitCode` and does not replace command `exitCode`.
      - prompt construction includes command metadata, stdout, stderr, and context.
      - public exports include only the intended functions and types.

      Add a narrow integration test using real `node:child_process.spawn` with fast Node commands that print stdout/stderr and exit zero/non-zero. Inject `runAgent` for follow-up; do not call a real agent.
    status:
      implement: done
      test: done
---

# Context

`@poe-code/agent-child-process` is a standalone v1 package. It should not be wired into existing callers, top-level SDK exports, CLI commands, GitHub workflow code, `process-runner`, `process-launcher`, Docker, or E2B runtimes.

The package mirrors `node:child_process` names and behavior where practical, while adding a single `onExit` follow-up hook. The hook can spawn an agent through `@poe-code/agent-spawn` after the command exits. The agent can inspect the original command metadata, stdout, stderr, and exit code, then modify files or run follow-up commands itself.

The library does not rerun commands automatically and does not rewrite command stdout/stderr. The original command attempt stays intact; any agent follow-up result is attached separately.
