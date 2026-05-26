# Dry-run experiment run creates a journal with zero experiments

## Summary

Running `experiment run` with `--dry-run` creates an empty journal sidecar file even when configured to perform zero experiments. No agent execution is needed to reproduce the write: the loop initializes the journal before determining there is no work to run.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable Git project with an experiment document that requires no iterations:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/docs/plans"

(
  cd "$probe/project"
  git init -q
  git config user.email probe@example.test
  git config user.name Probe

  cat > docs/plans/probe.md <<'EOF'
---
agent: codex
metric:
  name: tests
  script: printf 1
  direction: maximize
baseline:
  tests: 1
max_experiments: 0
---
# Probe
EOF

  git add docs/plans/probe.md
  git commit -q -m init

  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes experiment run \
    docs/plans/probe.md --max-experiments 0
)

ls -l "$probe/project/docs/plans/probe.journal.jsonl"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command reports a successful run summary with `Experiments: 0` and `Kept: 0`.
- An empty `docs/plans/probe.journal.jsonl` file is nevertheless created on disk.

## Expected Behavior

With `--dry-run`, `experiment run` must not initialize or write a journal file, particularly when zero experiments would be run. It should preview the workflow without persisting sidecars.

## Impact

- Merely checking an experiment run can dirty a worktree with new journal files.
- The no-write simulation contract is broken even when no agent, metric, or Git mutation is required.
- Automation that probes whether an experiment has work remaining can create artifacts unexpectedly.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/experiment.ts` invokes `sdkRunExperiment` without a dry-run branch, and `packages/experiment-loop/src/run/loop.ts` calls `journal.init()` before checking whether `experimentsCompleted >= maxExperiments`.

## Suspected Area

`experiment run` needs a dry-run path before loop initialization, or the experiment SDK must support non-persistent simulation without journal creation.
