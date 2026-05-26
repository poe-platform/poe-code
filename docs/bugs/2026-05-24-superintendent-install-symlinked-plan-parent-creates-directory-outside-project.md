# Superintendent install follows a symlinked plan parent and creates a directory outside the project

## Summary

The `superintendent install` command resolves the configured shared plan directory textually beneath the current project and creates it when absent without rejecting symbolic links in parent components. A symlinked `docs/plans` parent redirects plan-directory scaffolding outside the project.

## Reproduction

1. From the repository root, run this disposable project probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-superintendent-plan-dir-probe.XXXXXX)
   mkdir -p "$probe/project/.poe-code" "$probe/project/docs" "$probe/outside" "$probe/home"
   ln -s "$probe/outside" "$probe/project/docs/plans"
   cat > "$probe/project/.poe-code/config.json" <<'EOF'
   {"plan":{"plan_directory":"docs/plans/superintendent-new"}}
   EOF

   (cd "$probe/project" && HOME="$probe/home" \
     "$workspace/node_modules/.bin/tsx" --import "$workspace/scripts/register-template-loader.mjs" \
     "$workspace/src/index.ts" --yes superintendent install codex)

   realpath "$probe/project/docs/plans"
   find "$probe/outside" -maxdepth 2 -print | sort
   ```

## Observed Behavior

The command reports `Created: docs/plans/superintendent-new`, but the parent `docs/plans` resolves externally and the new `superintendent-new` directory is created beneath that external target.

`packages/superintendent/src/commands/install.ts:48` through `packages/superintendent/src/commands/install.ts:94` install the skill and scaffold the configured plan directory. `packages/superintendent/src/commands/install.ts:125` through `packages/superintendent/src/commands/install.ts:159` resolve and test the textual directory path without canonical-containment checks before `mkdir()` creates it.

## Expected Behavior

Superintendent installation should create shared plan directories only within the canonical configured project or user plan storage boundary. A symlinked path component escaping that boundary should be rejected.

## Impact

A crafted project configuration and local symlink can make a routine installation command create workflow state directories outside the repository while presenting the operation as a normal in-project scaffold.
