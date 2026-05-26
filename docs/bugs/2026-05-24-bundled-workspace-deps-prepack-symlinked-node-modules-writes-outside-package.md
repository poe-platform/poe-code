# Bundled workspace dependency preparation follows a symlinked node_modules directory and writes outside the package

## Summary

The bundled-workspace dependency preparation script extracts prepack dependencies beneath a package's `node_modules` tree without rejecting symbolic links. A symlinked `node_modules` directory redirects packed dependency contents outside the selected package.

## Reproduction

1. From the repository root, run this disposable package-output probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-bundled-deps-probe.XXXXXX)
   mkdir -p "$probe/pkg" "$probe/outside"
   ln -s "$probe/outside" "$probe/pkg/node_modules"

   node scripts/manage-bundled-workspace-deps.mjs prepare "$probe/pkg" auth-store

   realpath "$probe/pkg/node_modules"
   test -f "$probe/outside/auth-store/package.json" && echo external-package-created
   cat "$probe/pkg/.bundled-workspace-deps.json"
   ```

## Observed Behavior

The apparent package `node_modules` directory resolves to the external directory, and preparation extracts the bundled `auth-store` package beneath that external target while recording the apparent package-local path in the stamp file.

`scripts/manage-bundled-workspace-deps.mjs:36` through `scripts/manage-bundled-workspace-deps.mjs:41` derive dependency destinations beneath `node_modules`; `scripts/manage-bundled-workspace-deps.mjs:67` through `scripts/manage-bundled-workspace-deps.mjs:76` create, remove, extract, and rename through those destinations without canonical-containment or symlink checks.

## Expected Behavior

Prepack dependency preparation should extract bundled packages only beneath the canonical package `node_modules` tree. A symlinked dependency root resolving outside the package should be rejected.

## Impact

A crafted package checkout or altered packaging workspace can cause `prepack` preparation to populate or overwrite external package directories with developer or CI privileges.
