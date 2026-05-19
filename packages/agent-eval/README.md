# @poe-code/agent-eval

`@poe-code/agent-eval` is the private workspace package for running repeatable agent evaluation matrices: it opens an eval source directory, clones each target repo into isolated run directories, dispatches the configured plan through the selected agent or poe-code workflow, scores the resulting clone with the eval oracle, optionally asks a judge agent for rubric scores, writes per-run artifacts, and renders aggregate reports while the public CLI remains registered by `packages/poe-code`.

## Environment Variables

None.

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
poe-code eval run --agent claude-code --model anthropic/claude-opus-4.7
poe-code eval report
```

## Authoring an eval

An eval source is a directory containing one first-level folder per eval. Each eval folder contains `eval.yaml`, `plan.md`, an `oracle/` directory, and optionally `starter/`. `eval.yaml` defines metadata, target repo/ref, scorer command and result path, budgets, judge rubric, weights, and optional verification. `plan.md` contains YAML frontmatter with `kind` plus the task body dispatched to the agent or workflow. `oracle/` contains scorer assets, while `starter/` is copied into the cloned target before dispatch when present. The scorer command runs inside the clone and receives `CLONE_DIR` and `ORACLE_DIR` environment variables.

```text
<source>/
  .poe-code-eval.json
  <eval-id>/
    eval.yaml
    plan.md
    oracle/
    starter/
```

## Plan kinds

- `plan`: dispatches the `plan.md` body directly to the selected agent.
- `pipeline`: dispatches `poe-code pipeline run --plan <plan> --agent <agent> --model <model>`.
- `superintendent`: dispatches `poe-code superintendent run <plan> --agent <agent> --model <model>`.
- `experiment`: dispatches `poe-code experiment run --doc <plan> --agent <agent> --model <model>`.
