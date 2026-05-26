# Dry-run plan edit launches the editor and allows file writes

## Summary

Running `plan edit` with `--dry-run` still launches the configured editor for the selected plan. If the editor saves changes, the plan file is modified during an invocation that is documented as non-writing simulation mode.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, run this isolated reproduction using a harmless editor script that appends one line:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/project/docs/plans" "$probe/home"
printf '# Editable\n' > "$probe/project/docs/plans/edit.md"

cat > "$probe/fake-editor" <<'EOF'
#!/bin/sh
printf 'editor invoked on %s\n' "$1" > "$EDITOR_TRACE"
printf '\nchanged by editor\n' >> "$1"
EOF
chmod +x "$probe/fake-editor"

(
  cd "$probe/project"
  EDITOR_TRACE="$probe/trace" EDITOR="$probe/fake-editor" HOME="$probe/home" \
    npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes \
    plan edit docs/plans/edit.md
)

cat "$probe/trace"
cat "$probe/project/docs/plans/edit.md"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

The CLI prints `Edited docs/plans/edit.md`. The trace file confirms that the editor was invoked, and the plan file contains the added `changed by editor` line after the dry-run command completes.

## Expected Behavior

With `--dry-run`, `plan edit` must not launch an external editor capable of modifying the selected plan. It should report which file would be opened while leaving the document untouched.

## Impact

- Dry-run can open an interactive or scripted editor with full write access to project documents.
- Users relying on preview mode can accidentally save plan modifications.
- Automation can trigger arbitrary configured editor behavior despite requesting no writes.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. In `src/cli/commands/plan.ts`, `executePlanAction` resolves global flags but invokes `editPlan` immediately for the `edit` action without checking `flags.dryRun`.

## Suspected Area

The plan action dispatcher should short-circuit edit operations in dry-run mode before delegating to `editPlan` in `@poe-code/plan-browser`.
