# Bundled workspace dependency preparation follows a symlinked stamp file and overwrites outside the package

## Summary

The bundled-workspace dependency preparation script records extracted package paths in the fixed `.bundled-workspace-deps.json` file without rejecting symbolic links. A symlinked stamp destination redirects packaging state output outside the selected package.

## Reproduction

1. From the repository root, run this disposable package-output probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-bundled-stamp-probe.XXXXXX)
   mkdir -p "$probe/pkg"
   printf 'EXTERNAL ORIGINAL\n' > "$probe/outside.json"
   ln -s "$probe/outside.json" "$probe/pkg/.bundled-workspace-deps.json"

   node scripts/manage-bundled-workspace-deps.mjs prepare "$probe/pkg" auth-store

   realpath "$probe/pkg/.bundled-workspace-deps.json"
   cat "$probe/outside.json"
   ```

## Observed Behavior

The apparent packaging stamp file resolves externally, and `prepare` overwrites that external file with JSON containing the bundled dependency path.

`scripts/manage-bundled-workspace-deps.mjs:10` defines the fixed stamp name, and `scripts/manage-bundled-workspace-deps.mjs:79` through `scripts/manage-bundled-workspace-deps.mjs:83` write the packaging state file without checking whether its destination remains inside the package directory.

## Expected Behavior

Prepack state should be written only to a canonical stamp file within the selected package directory. A symlinked stamp destination that escapes the package should be rejected.

## Impact

A crafted package checkout or altered packaging state entry can make routine prepack preparation overwrite an external JSON or text file with build metadata using developer or CI privileges.
