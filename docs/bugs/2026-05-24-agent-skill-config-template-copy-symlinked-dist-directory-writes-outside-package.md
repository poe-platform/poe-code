# Agent skill config template copy follows a symlinked dist directory and writes outside the package

## Summary

The `@poe-code/agent-skill-config` template copy script writes Markdown templates into `dist/templates` without rejecting symbolic links. A symlinked output directory redirects ordinary package build output to an external location.

## Reproduction

1. From the repository root, run this disposable package-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-agent-skill-config-copy-probe.XXXXXX)
   mkdir -p "$probe/pkg/src/templates" "$probe/pkg/dist" "$probe/pkg/scripts" "$probe/outside"
   cp packages/agent-skill-config/scripts/copy-templates.mjs "$probe/pkg/scripts/"
   printf 'ESCAPED TEMPLATE\n' > "$probe/pkg/src/templates/probe.md"
   ln -s "$probe/outside" "$probe/pkg/dist/templates"

   (cd "$probe/pkg" && node scripts/copy-templates.mjs)

   realpath "$probe/pkg/dist/templates"
   cat "$probe/outside/probe.md"
   ```

## Observed Behavior

The apparent output directory `dist/templates` resolves to the external directory, and the script creates `probe.md` there containing `ESCAPED TEMPLATE`.

`packages/agent-skill-config/scripts/copy-templates.mjs:5` selects the fixed output directory, while `packages/agent-skill-config/scripts/copy-templates.mjs:7` and `packages/agent-skill-config/scripts/copy-templates.mjs:14` create and write through it without canonical-containment or symlink checks.

## Expected Behavior

Package template copying should write only into canonical directories under the package's build tree. A symlinked `dist/templates` directory that escapes the package should be rejected rather than followed.

## Impact

A crafted workspace or stale build-tree symlink can cause routine `@poe-code/agent-skill-config` build operations to write generated package assets outside the package with developer or CI privileges.
