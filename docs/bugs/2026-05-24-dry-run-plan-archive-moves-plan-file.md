# Dry-run plan archive moves plan files

## Summary

Running `plan archive` with `--dry-run` still moves the selected plan into `docs/plans/archive/`. The command performs the destructive filesystem operation while the CLI promises that dry-run mode simulates commands without writing changes.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run the command in an isolated temporary project:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project/docs/plans" "$probe/home"
printf '# Sample plan\n' > "$probe/project/docs/plans/sample.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes \
    plan archive docs/plans/sample.md
)

find "$probe/project/docs/plans" -type f -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The CLI prints:

```text
Archived docs/plans/sample.md
```

After execution, the original file is gone and the plan has been moved to:

```text
docs/plans/archive/sample.md
```

## Expected Behavior

With `--dry-run`, `plan archive` must not move or modify any plan file. It should indicate that the plan would be archived while leaving `docs/plans/sample.md` in place.

## Impact

- A preview command changes the location of planning documentation.
- Automation that relies on `--dry-run` can unintentionally alter active-plan discovery results.
- Users may believe a plan remains active while it has already been removed from its original location.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `executePlanAction` implementation in `src/cli/commands/plan.ts` resolves global flags but invokes `archivePlan` without checking `flags.dryRun`.

## Suspected Area

The `plan archive` and likely adjacent `plan delete` action paths need dry-run handling before invoking the filesystem mutation functions from `@poe-code/plan-browser`.
