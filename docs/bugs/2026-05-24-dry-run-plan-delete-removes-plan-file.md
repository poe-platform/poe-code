# Dry-run plan delete removes plan files

## Summary

Running `plan delete` with `--dry-run` still permanently deletes the selected plan file. The mutation occurs despite dry-run mode being documented as simulating commands without writing changes.

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
printf '# Delete me\n' > "$probe/project/docs/plans/delete-me.md"

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes \
    plan delete docs/plans/delete-me.md
)

test -f "$probe/project/docs/plans/delete-me.md"
echo $?
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The CLI prints:

```text
Deleted docs/plans/delete-me.md
```

The final `test -f` exits `1` because `docs/plans/delete-me.md` no longer exists after the dry-run invocation.

## Expected Behavior

With `--dry-run`, `plan delete` must leave the selected plan file untouched and only report that it would be deleted.

## Impact

- A command intended for preview can irreversibly remove planning documentation.
- Users can permanently lose an active plan while relying on the advertised no-write mode.
- Automation cannot safely validate plan-deletion selection with dry-run enabled.

## Supporting Evidence

The root CLI describes `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. The `executePlanAction` implementation in `src/cli/commands/plan.ts` invokes `deletePlan` without checking `flags.dryRun`.

## Suspected Area

The plan action dispatcher needs dry-run handling before invoking `deletePlan` and other destructive operations from `@poe-code/plan-browser`.
