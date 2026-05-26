# Agent harness template copy follows a symlinked dist directory and writes outside the package

## Summary

The `@poe-code/agent-harness` template copy script creates template-specific descendants beneath `dist/templates` and copies `.md` and `.ajs` files without rejecting symbolic links. A symlinked template output directory redirects package assets to an external location.

## Reproduction

1. From the repository root, run this disposable package-fixture probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-agent-harness-copy-probe.XXXXXX)
   mkdir -p "$probe/pkg/src/templates/demo" "$probe/pkg/dist/templates" "$probe/pkg/scripts" "$probe/outside"
   cp packages/agent-harness/scripts/copy-templates.mjs "$probe/pkg/scripts/"
   printf 'ESCAPED HARNESS TEMPLATE\n' > "$probe/pkg/src/templates/demo/probe.md"
   ln -s "$probe/outside" "$probe/pkg/dist/templates/demo"

   (cd "$probe/pkg" && node scripts/copy-templates.mjs)

   realpath "$probe/pkg/dist/templates/demo"
   cat "$probe/outside/probe.md"
   ```

## Observed Behavior

The apparent template output directory `dist/templates/demo` resolves to the external directory, and the script creates `probe.md` there containing `ESCAPED HARNESS TEMPLATE`.

`packages/agent-harness/scripts/copy-templates.mjs:5` establishes the output root; `packages/agent-harness/scripts/copy-templates.mjs:15` through `packages/agent-harness/scripts/copy-templates.mjs:16` derive and create each template output directory; and `packages/agent-harness/scripts/copy-templates.mjs:28` through `packages/agent-harness/scripts/copy-templates.mjs:31` copy through it without containment or symlink checks.

## Expected Behavior

Template copying should write only within canonical `dist/templates` descendants inside the package. Symlinked template output directories escaping the package should be rejected.

## Impact

A crafted workspace or modified build output can make routine `@poe-code/agent-harness` package builds write arbitrary template assets outside the package tree with developer or CI privileges.
