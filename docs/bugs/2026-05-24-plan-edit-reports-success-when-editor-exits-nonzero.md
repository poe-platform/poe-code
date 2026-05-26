# Plan edit reports success when editor exits nonzero

## Summary

The plan edit action launches `$EDITOR` synchronously but ignores its return status. When the editor fails or exits nonzero without completing an edit, the CLI still exits successfully and prints that the selected plan was edited.

## Reproduction

From the repository root, create a disposable plan project and run `plan edit` using an editor executable that immediately exits with status `17`:

```sh
repo=$PWD
tmp=$(mktemp -d /tmp/plan-edit-fail-XXXXXX)
mkdir -p "$tmp/repo/docs/plans" "$tmp/home"
printf '# Feature\n' > "$tmp/repo/docs/plans/feature.md"
cat > "$tmp/editor-fail.sh" <<'EOF'
#!/bin/sh
exit 17
EOF
chmod +x "$tmp/editor-fail.sh"
set +e
output=$(cd "$tmp/repo" && HOME="$tmp/home" EDITOR="$tmp/editor-fail.sh" \
  "$repo/node_modules/.bin/tsx" --import "$repo/scripts/register-template-loader.mjs" \
  "$repo/src/index.ts" --yes plan edit docs/plans/feature.md --output md 2>&1)
code=$?
set -e
printf '%s\nexit=%s\n' "$output" "$code"
nl -ba packages/plan-browser/src/actions.ts | sed -n '12,31p'
nl -ba src/cli/commands/plan.ts | sed -n '431,442p'
```

## Observed Behavior

The configured editor fails, but the CLI reports a completed edit and returns success:

```text
Edited docs/plans/feature.md
exit=0
```

`editFile()` invokes `spawnSync(editor, [absolutePath], ...)` and discards its result in `packages/plan-browser/src/actions.ts:12` through `packages/plan-browser/src/actions.ts:31`. `executePlanAction()` always prints `Edited ${plan.path}` after that call in `src/cli/commands/plan.ts:431` through `src/cli/commands/plan.ts:442`, with no status or error inspection.

## Expected Behavior

If the launched editor exits unsuccessfully or cannot be started, `plan edit` should fail and avoid reporting that the plan was edited.

## Impact

Users and automation receive a false success result when editing fails, potentially assuming requested plan updates were saved when no editor session completed. In scripted workflows this can allow later execution to proceed against unchanged planning instructions.
