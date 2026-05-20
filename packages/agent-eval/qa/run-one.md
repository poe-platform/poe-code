# Run One Eval

Manual QA plan for one throwaway `kind: plan` eval.

## 1. Create a tiny eval source

From the poe-code repo root, create a disposable eval source and a disposable target repo:

```sh
tmp_root="$(mktemp -d)"
target="$tmp_root/target"
source="$tmp_root/poe-code-eval"

mkdir -p "$target" "$source"
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

Create the eval from the template:

```sh
poe-code eval init create-file --target-repo "$target" --target-ref main
cd create-file
```

Edit the generated `plan.md`:

```sh
cat > plan.md <<'EOF'
---
kind: plan
version: 1
---

Create a file named OUTPUT.md at the repository root. Its contents must be exactly:

ok
EOF
```

Expected: the source directory has `.poe-code-eval.json` and `create-file/{eval.yaml,plan.md,oracle/tests/example.test.ts,oracle/solution/OUTPUT.md}`.

Triage notes:

- If `git commit` fails because identity is missing, configure a local temporary identity with `git config user.name "Eval QA"` and `git config user.email "eval-qa@example.invalid"`, then retry the commit.
- If branch setup fails, run `git branch -M main` again from the target repo and confirm `git branch --show-current` prints `main`.
- If later runs cannot find the target repo, confirm the `target.repo` value in `eval.yaml` is the absolute path printed by `$target`.

## 2. Check the eval oracle

```sh
poe-code eval check .
```

Expected: a case table prints and reports `1/1 cases passed`.

Triage notes:

- If check cannot find an eval source, confirm the current directory is `$source/create-file`.
- If a case fails, inspect `oracle/solution/` and `oracle/tests/example.test.ts`.

## 3. Lint the eval source

```sh
poe-code eval lint .
```

Expected: lint reports no errors for `create-file`.

Triage notes:

- If lint warns about target refs, `main` is still valid for this smoke check; pass a commit SHA to remove the warning.
- If lint reports missing files, compare the eval folder with the init template.

## 4. Run one eval

```sh
cd "$source"
poe-code eval run --agent claude-code --model anthropic/claude-opus-4.7 --repeats 1 --no-judge --no-verify
```

Expected: a result row prints with eval `create-file`, agent `claude-code`, model `anthropic/claude-opus-4.7`, and one run.

Triage notes:

- If `poe-code` is not found, run through the workspace dev command from the poe-code repo root, or ensure the package bin is linked.
- If the agent command is unavailable, verify the selected agent is installed and authenticated.
- If the result row has verdict `error`, inspect the `error` column or the generated `result.json` in the next step.

## 5. Inspect result.json

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
- `tests.cases`
- `cheated`
- `cheatReport`
- `error`, only when the run failed

Triage notes:

- If no run directory exists, the matrix failed before writing per-run artifacts; rerun the command and read the printed error.
- If `tests.total` is `0`, the scorer did not write the expected `{ passed, total }` result shape.
- If `cheated` is `true`, inspect `cheat-report.json` for a tool call that touched files outside the clone.

## 6. Render the latest report

```sh
poe-code eval report
```

Expected: the latest matrix renders as a table.

Triage notes:

- If no latest matrix is found, confirm `out` is `runs` in `.poe-code-eval.json` and that step 2 wrote a `runs/<matrix-id>/` directory.
- If the wrong matrix appears, pass `--out runs` from the intended eval source directory.
- If table output is hard to inspect, rerun with `--format md` or `--format json`.

## 7. Re-run with repeats and inspect aggregate output

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
