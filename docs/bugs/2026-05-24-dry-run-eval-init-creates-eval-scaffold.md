# Dry-run eval init creates eval scaffold

## Summary

Running `eval init` with the root `--dry-run` option still creates the complete eval scaffold in the current project.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run eval initialization in a clean disposable project:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run eval init probe-eval --kind plan
)

find "$probe/project" -maxdepth 6 -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and prints `probe-eval` plus a suggested next command.
- The command creates `probe-eval/eval.yaml`, `probe-eval/plan.md`, `probe-eval/starter/.gitkeep`, `probe-eval/oracle/solution/OUTPUT.md`, and `probe-eval/oracle/tests/example.test.ts`.

## Expected Behavior

With root `--dry-run`, `eval init` must not create an eval directory or any scaffold files. It should report the scaffold that would be created.

## Impact

- A preview of eval setup unexpectedly populates the working tree.
- Users cannot inspect generated eval shape without leaving artifacts.
- Automation that gates setup with `--dry-run` still performs project writes.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `eval` is registered as a forwarded Toolcraft command, while `packages/agent-eval/src/cli/commands.ts` routes `eval init` into `runInitCli` without a dry-run option.

## Suspected Area

Forwarded Toolcraft commands need root dry-run propagation, and eval initialization needs preview-aware write handling.
