# Superintendent template copy follows a symlinked dist directory and writes outside the package

## Summary

The `@poe-code/superintendent` template copy script writes Markdown templates into `dist/templates` without rejecting symbolic links. A symlinked output directory redirects normal package build output outside the package.

## Reproduction

1. From the repository root, run this disposable package-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-superintendent-copy-probe.XXXXXX)
   mkdir -p "$probe/pkg/src/templates" "$probe/pkg/dist" "$probe/pkg/scripts" "$probe/outside"
   cp packages/superintendent/scripts/copy-templates.mjs "$probe/pkg/scripts/"
   printf 'ESCAPED SUPERINTENDENT TEMPLATE\n' > "$probe/pkg/src/templates/probe.md"
   ln -s "$probe/outside" "$probe/pkg/dist/templates"

   (cd "$probe/pkg" && node scripts/copy-templates.mjs)

   realpath "$probe/pkg/dist/templates"
   cat "$probe/outside/probe.md"
   ```

## Observed Behavior

The apparent `dist/templates` output resolves to the external target, and the script writes `probe.md` outside the package containing `ESCAPED SUPERINTENDENT TEMPLATE`.

`packages/superintendent/scripts/copy-templates.mjs:5` selects the output directory, while `packages/superintendent/scripts/copy-templates.mjs:7` and `packages/superintendent/scripts/copy-templates.mjs:14` create and copy through it without checking for symlink escapes.

## Expected Behavior

Package template builds should copy only into canonical locations within the package build tree. A symlinked output directory resolving externally should be rejected.

## Impact

A crafted workspace or stale symlink in build output can make ordinary `@poe-code/superintendent` builds write externally controlled files with the privileges of the developer or CI job.
