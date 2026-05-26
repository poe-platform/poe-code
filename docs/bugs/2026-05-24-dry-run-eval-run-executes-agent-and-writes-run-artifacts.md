# Dry-run eval run executes agent and writes run artifacts

## Summary

Running `eval run` with the root `--dry-run` option still executes the selected agent and creates an evaluation run directory containing a cloned target and result evidence.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with a disposable local git target and a fake `codex` executable on `PATH`

## Reproduction

From the repository root, create a disposable eval source, local git target, and fake `codex` executable:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/source/task/oracle" "$probe/project/source/task/starter" "$probe/project/target" "$probe/bin"
(
  cd "$probe/project/target"
  git init -q -b main
  git config user.email probe@example.invalid
  git config user.name Probe
  printf 'target\n' > README.md
  git add README.md
  git commit -q -m init
)
cat > "$probe/project/source/task/eval.yaml" <<EOF
id: task
title: Dry-run eval probe
target:
  repo: $probe/project/target
  ref: main
  plan_dest: docs/plans/eval-task.md
scorer:
  command: node \"\$ORACLE_DIR/score.mjs\"
  result_path: score.json
  timeout_ms: 5000
oracle:
  path: oracle
budget:
  max_iterations: 10
  max_tokens: 100000
  wall_clock_ms: 60000
judge:
  agent: codex
  model: openai/gpt-5
  rubric:
    - completeness
weights:
  tests: 1
  judge: 0
EOF
cat > "$probe/project/source/task/plan.md" <<'EOF'
---
kind: plan
---
Implement the dry-run eval probe.
EOF
cat > "$probe/project/source/task/oracle/score.mjs" <<'EOF'
import { writeFile } from "node:fs/promises";
import path from "node:path";
await writeFile(path.join(process.env.CLONE_DIR, "score.json"), JSON.stringify({ passed: 1, total: 1, cases: [{ name: "probe", passed: true, durationMs: 0 }] }));
EOF
printf 'starter\n' > "$probe/project/source/task/starter/starter.txt"
cat > "$probe/bin/codex" <<'SH'
#!/bin/sh
printf 'executed:%s\n' "$*" >> "$FAKE_MARKER"
cat >/dev/null || true
exit 0
SH
chmod +x "$probe/bin/codex"

(
  cd "$probe/project"
  PATH="$probe/bin:$PATH" FAKE_MARKER="$probe/agent-marker" HOME="$probe/home" \
    /path/to/poe-code/node_modules/.bin/tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run eval run \
    -C "$probe/project/source" --eval task --agent codex --model openai/gpt-5 \
    --repeats 1 --out "$probe/project/runs" --no-verify --no-judge
)

cat "$probe/agent-marker"
find "$probe/project/runs" -type f | sort
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The fake `codex` executable is invoked with the eval plan prompt and selected model despite root `--dry-run`.
- The command creates a timestamped matrix/run output hierarchy, clones the local git target, and copies the plan into the clone.
- The run writes evidence and summary files including `events.jsonl`, `trace.json`, `cheat-report.json`, `result.json`, `eval.yaml`, `plan.md`, and an aggregate JSON file.

## Expected Behavior

With root `--dry-run`, running an eval matrix must not invoke agents, clone targets, or write evaluation artifacts. It should preview the cells and operations that would be executed.

## Impact

- A preview can incur agent/API usage and execute arbitrary configured agent binaries.
- Dry-run creates substantial output and git clone state, potentially overwriting or polluting evaluation results.
- Users cannot safely inspect an eval matrix before executing expensive or sensitive workloads.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`, but forwarded Toolcraft flags do not include `--dry-run`. `packages/agent-eval/src/cli/commands.ts` sends `eval run` directly to `runMatrix`, and `packages/agent-eval/src/run/run.ts` clones targets, dispatches agents, and persists run evidence and results without preview handling.

## Suspected Area

Forwarded eval commands need root dry-run propagation and preview-only guards before cloning, agent dispatch, scoring, and result persistence.
