# Run One Eval

Manual QA plan for one throwaway `kind: plan` eval.

## 1. Create a tiny eval source

From the poe-code repo root, create a disposable eval source and a disposable target repo:

```sh
tmp_root="$(mktemp -d)"
target="$tmp_root/target"
source="$tmp_root/poe-code-eval"

mkdir -p "$target" "$source/create-file/oracle"
cd "$target"
git init
git branch -M main
printf '# Eval target\n' > README.md
git add README.md
git commit -m "chore: seed eval target"
```

Create the eval config:

```sh
cd "$source"
cat > .poe-code-eval.json <<'JSON'
{
  "judge": {
    "agent": "claude-code",
    "model": "anthropic/claude-opus-4.7"
  },
  "out": "runs",
  "weights": {
    "tests": 1,
    "judge": 0
  },
  "clone_cache_dir": null
}
JSON
```

Create `create-file/eval.yaml`:

```sh
cat > create-file/eval.yaml <<EOF
id: create-file
title: Create file smoke eval
target:
  repo: $target
  ref: main
  plan_dest: docs/plans/eval-task.md
scorer:
  command: node "\$ORACLE_DIR/score.mjs"
  result_path: score.json
  timeout_ms: 5000
oracle:
  path: oracle
budget:
  max_iterations: 5
  max_tokens: 100000
  wall_clock_ms: 120000
judge:
  agent: claude-code
  model: anthropic/claude-opus-4.7
  rubric:
    - completeness
weights:
  tests: 1
  judge: 0
EOF
```

Create `create-file/plan.md`:

```sh
cat > create-file/plan.md <<'EOF'
---
kind: plan
---

Create a file named eval-output.txt at the repository root. Its contents must be exactly:

hello from eval
EOF
```

Create `create-file/oracle/score.mjs`:

```sh
cat > create-file/oracle/score.mjs <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
try {
  const content = readFileSync(join(process.env.CLONE_DIR, "eval-output.txt"), "utf8");
  if (content.trim() === "hello from eval") {
    passed = 1;
  }
} catch {
  passed = 0;
}

writeFileSync(join(process.env.CLONE_DIR, "score.json"), JSON.stringify({ passed, total: 1 }));
EOF
```

Expected: the source directory has `.poe-code-eval.json` and `create-file/{eval.yaml,plan.md,oracle/score.mjs}`.

Triage notes:

- If `git commit` fails because identity is missing, configure a local temporary identity with `git config user.name "Eval QA"` and `git config user.email "eval-qa@example.invalid"`, then retry the commit.
- If branch setup fails, run `git branch -M main` again from the target repo and confirm `git branch --show-current` prints `main`.
- If later runs cannot find the target repo, confirm the `repo:` value in `eval.yaml` is the absolute path printed by `$target`.

## 2. Run one eval

```sh
cd "$source"
poe-code eval run --agent claude-code --model anthropic/claude-opus-4.7 --repeats 1 --no-judge --no-verify
```

Expected: a result row prints with eval `create-file`, agent `claude-code`, model `anthropic/claude-opus-4.7`, and one run.

Triage notes:

- If `poe-code` is not found, run through the workspace dev command from the poe-code repo root, or ensure the package bin is linked.
- If the agent command is unavailable, verify the selected agent is installed and authenticated.
- If the result row has verdict `error`, inspect the `error` column or the generated `result.json` in the next step.

## 3. Inspect result.json

Find the latest run directory:

```sh
matrix_dir="$(ls -td runs/* | head -n 1)"
run_dir="$(find "$matrix_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
cat "$run_dir/result.json"
```

Expected fields:

- `runId`
- `eval`
- `agent`
- `model`
- `planKind`
- `verdict`
- `correctness`
- `iterations`
- `durationMs`
- `usage`
- `tests`
- `cheated`
- `cheatReport`
- `error`, only when the run failed

Triage notes:

- If no run directory exists, the matrix failed before writing per-run artifacts; rerun the command and read the printed error.
- If `tests.total` is `0`, the scorer did not write the expected `{ passed, total }` result shape.
- If `cheated` is `true`, inspect `cheat-report.json` for a tool call that touched files outside the clone.

## 4. Render the latest report

```sh
poe-code eval report
```

Expected: the latest matrix renders as a table.

Triage notes:

- If no latest matrix is found, confirm `out` is `runs` in `.poe-code-eval.json` and that step 2 wrote a `runs/<matrix-id>/` directory.
- If the wrong matrix appears, pass `--out runs` from the intended eval source directory.
- If table output is hard to inspect, rerun with `--format md` or `--format json`.

## 5. Re-run with repeats and inspect aggregate output

```sh
poe-code eval run --agent claude-code --model anthropic/claude-opus-4.7 --repeats 3 --no-judge --no-verify
matrix_dir="$(ls -td runs/* | head -n 1)"
ls "$matrix_dir"/aggregate-*.json
cat "$matrix_dir"/aggregate-*.json
```

Expected: an `aggregate-create-file-claude-code-anthropic-claude-opus-4.7.json` file exists and reports three repeats with aggregate stats for iterations, duration, usage, tests, and correctness.

Triage notes:

- If fewer than three repeats are listed, check whether one run is still active or whether the command stopped early with an error.
- If aggregate output is missing, confirm the command completed after the third result row printed.
- If repeated runs are slow or flaky, keep `--no-judge --no-verify` enabled while isolating agent or scorer failures.
