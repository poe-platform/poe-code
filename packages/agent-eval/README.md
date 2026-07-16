# @poe-code/agent-eval

`@poe-code/agent-eval` runs repeatable agent evaluation matrices. It opens an eval source directory, clones each target repo into isolated run directories, dispatches the configured plan through the selected agent or poe-code workflow, scores the resulting clone with the eval oracle, optionally asks a judge agent for rubric scores, writes per-run artifacts, and renders aggregate reports.

This is a private workspace package. The public CLI entry is registered by the root `poe-code` package.

## Environment Variables

`agent-eval` does not define package-level environment variables. Scorer commands receive per-run variables such as `CLONE_DIR` and `ORACLE_DIR`; configure agent credentials through the selected poe-code agent/provider instead.

## Configuration

Configuration lives at `<source>/.poe-code-eval.json`.

Supported keys:

- `judge`: default judge override with `agent` and `model`.
- `out`: output directory for matrix runs and reports, relative to the source directory unless absolute.
- `weights`: scoring weights with `tests` and `judge`.
- `clone_cache_dir`: optional shared clone cache directory, or `null`.

## CLI Quickstart

```sh
cd ../poe-code-eval
poe-code eval run --agent claude-code --model <model-id>
poe-code eval report
```

## CLI Commands

| Command                | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `poe-code eval run`    | Run an eval matrix for one or more agents.      |
| `poe-code eval report` | Render run reports as table, Markdown, or JSON. |
| `poe-code eval init`   | Create a minimal eval folder.                   |
| `poe-code eval check`  | Verify an eval oracle against its solution.     |
| `poe-code eval lint`   | Lint eval metadata without cloning targets.     |

## Manual QA

Use [qa/run-one.md](qa/run-one.md) for a throwaway single-eval validation pass.

## Authoring an eval

Start from the CLI template, then edit the generated task prompt and oracle:

```sh
poe-code eval init my-task --target-repo https://github.com/owner/repo.git
cd my-task
# edit plan.md, oracle/tests/, oracle/solution/
poe-code eval check .
poe-code eval lint .
```

`poe-code eval init` creates `eval.yaml`, `plan.md`, `oracle/tests/example.test.ts`, `oracle/solution/`, and `starter/`. `eval.yaml` defines metadata, target repo/ref, budgets, judge rubric, weights, and optional verification. `plan.md` contains YAML frontmatter with `kind` plus the task body dispatched to the agent or workflow. `starter/` is copied into the cloned target before dispatch when present.

By default, the scorer is the vitest convention: tests live in `oracle/tests/`, receive `CLONE_DIR` and `ORACLE_DIR` environment variables, and run automatically with `vitest run`. Use `CLONE_DIR` to inspect the agent's edited target clone and `ORACLE_DIR` to read oracle assets.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLONE_DIR = process.env.CLONE_DIR!;
const ORACLE_DIR = process.env.ORACLE_DIR!;

describe("example", () => {
  it("agent created the expected file", () => {
    const actual = readFileSync(join(CLONE_DIR, "OUTPUT.md"), "utf8");
    const expected = readFileSync(join(ORACLE_DIR, "solution", "OUTPUT.md"), "utf8");
    expect(actual).toBe(expected);
  });
});
```

Set `scorer.command` in `eval.yaml` when you need a non-vitest scorer, such as a Python target, `cargo test`, or a custom validation script. Custom scorers run inside the clone and still receive `CLONE_DIR` and `ORACLE_DIR`; they must write the configured result file.

Per-case scorer output is written to each run's `result.json` under `tests.cases`.

## Plan kinds

- `plan`: dispatches the `plan.md` body directly to the selected agent.
- `pipeline`: dispatches `poe-code pipeline run --plan <plan> --agent <agent> --model <model>`.
- `superintendent`: dispatches `poe-code superintendent run <plan> --agent <agent> --model <model>`.
- `experiment`: dispatches `poe-code experiment run --doc <plan> --agent <agent> --model <model>`.
