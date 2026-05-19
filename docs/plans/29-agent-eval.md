---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent Eval

Reusable eval framework for measuring how different models and agent harnesses solve a fixed set of golden tasks.

## 1. What we're building

A `@poe-code/agent-eval` package and `poe-code eval` CLI on top of `agent-spawn` (and optionally the `agent-harness` runner). The unit of work is an **eval task** defined by a markdown file with YAML frontmatter — the same shape used elsewhere in the repo (pipeline, experiment-loop, superintendent plans).

For each (task × agent × model) combination, the eval:

- Spawns the agent in an isolated workspace, gives it the task prompt, lets it run to completion.
- Records: wall-clock time, iterations (tool-call turns), tokens (input/output/cached, cost), and a correctness verdict.
- Compares the agent's solution against a hidden **oracle solution** to produce the verdict.

### Correctness — combination of tests and judge

The correctness verdict combines two signals:

1. **Tests (primary, gating).** Each task ships with a hidden test suite. The task prompt includes the API contract (CLI flags, function signatures, file formats) so the agent isn't penalized for trivial naming mismatches. The oracle solution must pass its own tests; the agent's output is scored against the same suite. Result: `tests_passed: n/total`.
2. **Agent judge (secondary, informational).** A judge agent reads the agent's diff, test output, and the prompt, then scores completeness, spec adherence, and code quality on 0–5 rubrics. Result: `judge_score: { completeness, spec_adherence, code_quality }`.
3. **Cheating check (gating).** Any tool-call (read, exec, glob) targeting paths inside the bundled `oracles/` dir or the extracted oracle temp dir flips `cheated: true` and zeroes the run regardless of tests or judge.

Final correctness is `(tests_pass_rate × 0.7) + (judge_mean / 5 × 0.3)` when `cheated === false`, else `0`. Weights are configurable.

The oracle source is configured per task. Two storage modes are supported:

- **External**: a separate git repo or URL fetched at scoring time.
- **Bundled**: a plain zip inside the eval package (`oracles/<task>.zip`). The scorer extracts it to a temp dir at score time; the agent's workspace never contains the zip or its extracted contents.

When the oracle ships inside the repo, the eval must verify the agent did not cheat. Detection is path-based: agent-spawn already emits ACP-style tool-call events (read/write/exec). The scorer scans the run log for any access (read, exec, glob) targeting paths inside the oracle zip or the bundled `oracles/` directory and flags the run as `cheated: true`.

### Three golden tasks (initial set)

Tasks must be things we will **never** build into poe-code itself, but should be **consumers of poe-code primitives** — they exercise our published packages as dependencies. Each is multi-day work, well specced, with a real test suite.

#### Task 1 — `mcp-load-tester`

A CLI that load-tests an arbitrary MCP server.

- Connects via `tiny-mcp-client` (both `StdioTransport` and `HttpTransport`).
- Discovers tools, caches schemas via `@poe-code/cached-resource` (memory → disk → bundled fallback).
- Generates synthetic call payloads at a target token size via `tokenfill`.
- Runs a configurable workload (RPS, duration, concurrency=1 in v1) and records per-call latency, error rate, payload tokens.
- Renders a live dashboard via `@poe-code/design-system` (components + tokens).
- Writes per-run JSONL results behind `@poe-code/file-lock` so repeat runs don't clobber.
- CLI surface: `mcp-load-tester run <server-locator> --duration 30s --rps 5 --tool <name>`.

#### Task 2 — `kb` (markdown knowledge-base server)

A CLI + MCP server over a directory of markdown docs.

- Indexes a tree of markdown via `@poe-code/markdown-reader` (TOC + section-level reads).
- Accepts directory locators (`./docs`, `git+https://…`, `gh:owner/repo`) through `@poe-code/workspace-resolver`.
- Exposes operations declaratively with `toolcraft` so the same definitions produce CLI, MCP server, and SDK: `kb.search`, `kb.read`, `kb.outline`, `kb.cite`.
- Tracks "reading list" assignments per consumer via `@poe-code/task-list` (yaml-file backend), state machine `draft → planned → in-progress → done → archived`.
- Resolves `extends:` chains across plan docs via `@poe-code/config-extends`.

#### Task 3 — `cronctl` (declarative job runner)

A persistent CLI that runs cron-like jobs declared in YAML.

- Parses a `jobs.yaml` (`schedule`, `command`, `runtime: host|docker`) and schedules each.
- Executes jobs through `@poe-code/process-runner` — both host and docker runners.
- Maintains a state file (`runs.json`) with `@poe-code/file-lock` for atomic updates.
- Caches per-job results via `@poe-code/cached-resource` so consumers can read the last successful output offline.
- Exposes `cronctl list | status | run-now | logs | stop` through `toolcraft` (CLI + MCP + SDK from one definition).
- Live dashboard via `@poe-code/design-system` for `cronctl status --watch`.

Each task ships with: a prompt markdown, starter `package.json` referencing the required `@poe-code/*` packages, the oracle solution (in `oracles/<task>.zip`), and a scorer (test suite that the oracle passes and the agent's output must also pass).

### Non-goals

- Not a benchmark-publishing platform; results are local artifacts (JSONL/markdown).
- Not for evaluating poe-code itself end-to-end (that's e2e tests / superintendent runs).
- No parallel sandbox execution in v1 — sequential only (matches the working assumption).
- No web UI / dashboard.

## 2. User-facing shape

### CLI

```bash
poe-code eval run  --agent <a,b,…>  --model <a,b,…>     # both required, list-valued
                  [--task <a,b,…>]                       # default: all bundled tasks
                  [--repeats <n>] [--judge <agent>] [--no-judge]
                  [--no-verify] [--out <dir>]
poe-code eval report [<run-id>] [--format json|md|table]
```

`run` is the primary command — pass one value per flag for a single cell, lists for a matrix. `--agent` and `--model` are **required** (no defaults, no interactive prompt fallback): every run states explicitly what is being measured. `--task` defaults to all bundled tasks. Verify (oracle passes its own tests) runs automatically as a preflight on every cell unless `--no-verify`. `report` with no arg shows the latest matrix; with a `<run-id>`, shows that cell. Tasks ship inside the `@poe-code/agent-eval` package — there is nothing for the user to scaffold or author.

### Task file format

One markdown file per task, YAML frontmatter + body. Lives at `.poe-code/eval/tasks/<id>.md`.

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/eval/task.schema.json
kind: eval-task
version: 1
id: mcp-load-tester
title: MCP load tester CLI
oracle:
  source: bundled
  path: oracles/mcp-load-tester.zip
scorer:
  command: npm test
  timeout_ms: 120000
  weight:
    tests: 0.7
    judge: 0.3
budget:
  max_iterations: 60
  max_tokens: 500000
  wall_clock_ms: 600000
judge:
  agent: claude-code
  model: anthropic/claude-opus-4.7
rubric:
  - completeness
  - spec_adherence
  - code_quality
---

# Build `mcp-load-tester`

A CLI that load-tests an arbitrary MCP server…

## API contract

The CLI must expose:

    mcp-load-tester run <server-locator> --duration 30s --rps 5 --tool <name>
    mcp-load-tester report <run-id> [--format json|md]

… (full prompt continues — signatures, file formats, expected JSONL schema)
```

Alternate oracle (external repo):

```yaml
oracle:
  source: git
  url: git+https://github.com/poe-platform/eval-oracles.git
  ref: main
  path: mcp-load-tester
```

### Run output

Per-run artifact at `.poe-code/eval/runs/<run-id>/`:

```
result.json           # structured verdict
prompt.md             # exact prompt sent to the agent
events.jsonl          # agent-spawn ACP events (tool calls, usage, errors)
workspace/            # final agent workspace snapshot
judge.json            # judge agent output (if enabled)
cheat-report.json     # paths flagged as oracle-adjacent (always written; empty when clean)
```

`result.json` shape:

```json
{
  "run_id": "2026-05-18T14-22-08Z-mcp-load-tester-claude-code-opus-4.7",
  "task": "mcp-load-tester",
  "agent": "claude-code",
  "model": "anthropic/claude-opus-4.7",
  "started_at": "2026-05-18T14:22:08Z",
  "duration_ms": 412300,
  "iterations": 47,
  "usage": { "input_tokens": 184230, "output_tokens": 21044, "cached_tokens": 91200, "cost_usd": 1.84 },
  "tests": { "passed": 12, "total": 14, "pass_rate": 0.857 },
  "judge": { "completeness": 4, "spec_adherence": 5, "code_quality": 3, "mean": 4.0 },
  "cheated": false,
  "correctness": 0.84,
  "verdict": "pass"
}
```

### Matrix report (terminal)

```
poe-code eval matrix --tasks mcp-load-tester,kb,cronctl \
                     --agents claude-code,codex \
                     --models opus-4.7,gpt-5.5

Task              Agent        Model       Iters  Time     Tokens     $       Tests   Judge  Correct  Verdict
mcp-load-tester   claude-code  opus-4.7    47     6m52s    205k       $1.84   12/14   4.0    0.84     pass
mcp-load-tester   codex        gpt-5.5     63     11m04s   312k       $2.41    9/14   3.3    0.65     pass
kb                claude-code  opus-4.7    82     14m11s   421k       $3.92    8/10   4.7    0.84     pass
kb                codex        gpt-5.5     ─      ─        ─          ─       ─       ─      0.00     cheated
cronctl           claude-code  opus-4.7    71     12m38s   389k       $3.51    7/9    3.7    0.77     pass
cronctl           codex        gpt-5.5     94     18m02s   501k       $4.18    9/9    4.0    0.94     pass
```

`--format md` writes the same table as a markdown report; `--format json` emits an array of `result.json` objects.
