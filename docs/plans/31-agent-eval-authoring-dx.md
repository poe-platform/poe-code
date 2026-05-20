---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent Eval — Authoring DX

Make authoring an eval feel like writing tests, not writing a test runner. Five additions to `@poe-code/agent-eval` focused on the author's inner loop.

## 1. What we're building

The harness exists (see `docs/plans/archive/agent-eval.md`). Today, authoring a new eval means hand-writing a Node script that reaches into `CLONE_DIR`, runs commands, parses output, and writes `{ passed, total }` to a JSON file. That's the friction we're removing.

Five additions:

1. **Default scorer = vitest.** Authors put vitest tests in `oracle/tests/`. The harness ships a built-in scorer that runs them with the standard `vitest run` flow. Tests receive `process.env.CLONE_DIR` and `process.env.ORACLE_DIR`. `eval.yaml`'s `scorer.command` becomes optional — provide it only when you need to escape vitest (e.g. a Python target, a CLI that wants `cargo test`).
2. **`poe-code eval check <path>`.** Runs the oracle's reference solution against the scorer with no agent spawn. Single command, ~5-second feedback loop while iterating on tests or the solution. The most-used command an author will touch.
3. **Per-case results in `result.json`.** Replace `tests: { passed: 12, total: 14 }` with `tests: { cases: [{ name, passed, durationMs, message? }] }`. Both the per-cell artifact and the aggregate roll-up keep the existing summary, but failures are now legible without re-running.
4. **`poe-code eval init <name>`.** Scaffolds a lint-clean eval folder: `eval.yaml`, `plan.md` (frontmatter + one-line prompt), `oracle/tests/example.test.ts`, `oracle/solution/.gitkeep`. Author edits, doesn't start from blank.
5. **`poe-code eval lint <path>`.** Static checks in milliseconds: `eval.yaml` validates, `plan.md` frontmatter has a supported `kind`, `oracle/tests/` contains at least one `*.test.ts` file, every file referenced by tests via `path.join(ORACLE_DIR, …)` literals exists, `oracle/solution/` is non-empty when `eval check` is expected to pass.

### The new authoring loop

```
poe-code eval init my-task           # scaffold
cd my-task
# edit plan.md, oracle/tests/, oracle/solution/
poe-code eval check .                # tight iteration; no agent spawn
poe-code eval lint .                 # final sanity
git add . && git commit
```

No node-script-writing. No reinventing a test runner per eval.

### Non-goals

- Not changing the `scorer.command` escape hatch. Evals that need a non-vitest test runner can still override.
- Not changing how the harness runs `runEval` / `runMatrix` — those stay identical.
- Not adding watch mode, live-reload, or other dev-server features in v1. `eval check` is fast enough.
- Not adding statistical confidence intervals or model-version pinning (different direction from authoring DX).
