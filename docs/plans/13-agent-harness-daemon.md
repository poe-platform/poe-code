---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent Harness Daemon

A long-running daemon that polls task-list backends and dispatches each task through a harness workflow.

## 1. What we're building

A new `agent-harness-daemon` package: a long-running process that polls one or more task lists, picks up actionable tasks, and runs an agent-script harness flow per task. Task sources go through the existing `task-list` abstraction (extending it where needed, not duplicating). The daemon itself is generic — repo-specific behavior comes from the configured task sources and the harness docs they bind to.

The two concrete use cases this repo will configure on top of the generic daemon:

- **PRs by `kamilio`, status open** — for each open PR, check the CI build for the head commit; if failing, run a fix-it harness and push.
- **Main branch monitor** — watch latest commit on `main`; if its build is failing, run the same fix-it harness against `main`.

State is persisted as `pr#<commit_sha> → status` (and `main#<commit_sha> → status` for the main monitor) so the daemon doesn't re-process a SHA it has already seen.

The "tasks" surface for the daemon — what it reads to know what to do — is expressed via the task-list abstraction. The new piece is a backend that returns PRs (or branch heads) as tasks. The user noted "this probably should be in agent-script": treating that as an open thread for level 3 — whether the daemon's per-task work is described as an agent-script harness doc, or whether the daemon is a thinner runner that calls the harness directly.

### In scope

- New `agent-harness-daemon` package with a CLI entrypoint (daemon-style: long-running, polls on an interval, graceful shutdown).
- New `task-list` backend: **GitHub PRs by author/status/repo** (returns each matching PR as a task; metadata carries head SHA, branch, CI conclusion).
- State store: JSON file keyed by `<source>#<commit_sha> → status`, so re-polls don't re-run on the same SHA.
- Generic config that lets a deployer point the daemon at one or more task sources, each bound to a harness doc.
- Repo-local config for the two concrete cases above.

### Out of scope (deferred)

- Picking up GitHub issues as daemon tasks.
- Parallel execution of tasks — sequential only, one task at a time (matches the project's "sequential only" working assumption).
- Multi-machine coordination / leader election.

## 2. User-facing shape

### Package and CLI

`@poe-code/agent-harness-daemon` ships a `poe-harness-daemon` binary. SDK exports `runDaemon(opts)` and `pollOnce(opts)` so the CLI is a thin wrapper.

```text
poe-harness-daemon start --config <path>          # long-running, polls until SIGINT/SIGTERM
poe-harness-daemon once  --config <path>          # single poll cycle, exits 0 if all sources clean
poe-harness-daemon list  --config <path>          # print actionable tasks per source, no execution
poe-harness-daemon state --config <path>          # print state.json contents in a table
poe-harness-daemon state clear --config <path> --source <name> [--key <sha>]
                                                  # drop one entry or a whole source
```

Common flags on every command:

- `--config <path>` (required) — daemon config file; relative paths resolve against `cwd`.
- `--state <path>` — overrides `state` in config; default is `<config-basename>.state.json` next to the config file.
- `--once` (alias for the `once` subcommand on `start`, useful for cron).
- `--source <name>` — restrict to one source from the config (debugging).
- `--verbose` / `-v` — stream per-task harness logs to stdout in addition to the log file.
- `--yes` — accept defaults for any prompt; the daemon never prompts otherwise.

### Daemon config file

JSON, explicit. One file per deployment. `polling.intervalMs` is required (no implicit default — per "explicit over implicit"). `sources[]` binds a task-list backend to a harness doc.

```json
{
  "$schema": "https://poe-platform.github.io/poe-code/schemas/agent-harness-daemon/config.schema.json",
  "polling": {
    "intervalMs": 300000,
    "jitterMs": 15000
  },
  "state": "./harness-daemon.state.json",
  "logDir": "./.harness-daemon-logs",
  "sources": [
    {
      "name": "kamilio-open-prs",
      "taskList": {
        "type": "gh-prs",
        "repo": "poe-platform/poe-code",
        "filter": { "state": "open", "author": "kamilio" }
      },
      "harness": {
        "doc": "./harnesses/fix-failing-pr.md",
        "cwdStrategy": "worktree-from-head"
      },
      "selectTask": {
        "where": { "metadata.ciConclusion": "failure" }
      }
    },
    {
      "name": "main-branch-monitor",
      "taskList": {
        "type": "gh-branch-head",
        "repo": "poe-platform/poe-code",
        "branch": "main"
      },
      "harness": {
        "doc": "./harnesses/fix-failing-main.md",
        "cwdStrategy": "worktree-from-head"
      },
      "selectTask": {
        "where": { "metadata.ciConclusion": "failure" }
      }
    }
  ]
}
```

Each source field, explicitly:

- `taskList`: any valid `OpenTaskListOptions` from `task-list`. The two new backend types — `gh-prs` and `gh-branch-head` — return tasks shaped like the existing backends but with metadata fields specific to PRs/branches (see level 3).
- `harness.doc`: path to an agent-script harness markdown doc. The daemon runs `runDocumentWorkflow` against it, one invocation per actionable task.
- `harness.cwdStrategy`: `"worktree-from-head"` (default — daemon prepares a git worktree at the task's head SHA before invoking the harness) or `"as-is"` (run in the daemon's cwd; the harness is responsible for checkout).
- `selectTask.where`: simple metadata predicate. Tasks not matching are still recorded in state as "skipped" so they don't get reconsidered until their SHA changes.

### State file

JSON, written atomically after each task completes. Keys are `<source-name>#<commit-sha>`.

```json
{
  "version": 1,
  "entries": {
    "kamilio-open-prs#a1b2c3d4": {
      "status": "succeeded",
      "taskQualifiedId": "gh-prs/1234",
      "lastRunAt": "2026-05-04T14:21:09Z",
      "lastDurationMs": 184221,
      "harnessDoc": "./harnesses/fix-failing-pr.md"
    },
    "main-branch-monitor#9f8e7d6c": {
      "status": "skipped",
      "reason": "ci-passing",
      "lastSeenAt": "2026-05-04T14:25:01Z"
    }
  }
}
```

`status` values: `"succeeded" | "failed" | "skipped" | "in-progress"`. An entry with `"in-progress"` blocks re-entry on that key — if the daemon crashes mid-task, restart preserves the in-progress marker, and the operator clears it via `state clear`.

### Example terminal session

```text
$ poe-harness-daemon start --config ./harness-daemon.config.json
[14:21:00] daemon started · config=./harness-daemon.config.json · interval=5m
[14:21:00] poll cycle 1 begin
[14:21:01] kamilio-open-prs: 4 open PRs · 1 actionable (PR #1234, ci=failure, sha=a1b2c3d4)
[14:21:01] main-branch-monitor: HEAD=9f8e7d6c · ci=success · skip
[14:21:02] dispatch: kamilio-open-prs#a1b2c3d4 → ./harnesses/fix-failing-pr.md
[14:21:02] worktree: prepared at /tmp/harness-daemon/kamilio-open-prs/a1b2c3d4
[14:21:02] harness: fix-failing-pr.md iteration 1
…
[14:24:06] harness: completed · pushed 1 commit (b5c6d7e8) to feat/foo
[14:24:06] state: kamilio-open-prs#a1b2c3d4 → succeeded
[14:24:06] poll cycle 1 done · next in 5m

^C
[14:24:18] SIGINT received · finishing current task before exit (none in flight)
[14:24:18] daemon stopped cleanly
```

```text
$ poe-harness-daemon list --config ./harness-daemon.config.json
source                  task              ci         action
kamilio-open-prs        PR #1234 (a1b2…)  failure    run
kamilio-open-prs        PR #1230 (d4e5…)  success    skip
kamilio-open-prs        PR #1228 (f6a7…)  pending    skip
kamilio-open-prs        PR #1219 (b8c9…)  success    skip
main-branch-monitor     main HEAD (9f8e…) success    skip
```

```text
$ poe-harness-daemon state --config ./harness-daemon.config.json
source                  sha       status        last run               duration
kamilio-open-prs        a1b2c3d4  succeeded     2026-05-04 14:24:06    3m4s
main-branch-monitor     9f8e7d6c  skipped       2026-05-04 14:25:01    —
```

### Repo-local configuration (this repo)

Lives under `tools/harness-daemon/` with two harness docs (`fix-failing-pr.md`, `fix-failing-main.md`) and a single config file. Run via `npm run harness-daemon` (script wraps `poe-harness-daemon start --config tools/harness-daemon/config.json`). Not started automatically — operator-launched per "overnight detach workflow" memory.
