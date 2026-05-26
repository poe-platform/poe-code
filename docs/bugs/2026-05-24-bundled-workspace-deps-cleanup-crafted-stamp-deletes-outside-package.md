# Bundled workspace dependency cleanup trusts crafted stamp paths and deletes outside the package

## Summary

The bundled-workspace dependency cleanup script reads absolute directory paths from `.bundled-workspace-deps.json` and recursively deletes them without validating that they belong to the selected package's bundled dependency tree. A crafted stamp file causes cleanup to delete an external directory.

## Reproduction

1. From the repository root, run this disposable package-state probe:

   ```sh
   probe=$(mktemp -d /tmp/poe-bundled-cleanup-probe.XXXXXX)
   mkdir -p "$probe/pkg" "$probe/outside/keep"
   printf 'REMOVE ME\n' > "$probe/outside/keep/marker.txt"
   printf '{"bundledDirs":["%s"]}\n' "$probe/outside/keep" \
     > "$probe/pkg/.bundled-workspace-deps.json"

   node scripts/manage-bundled-workspace-deps.mjs cleanup "$probe/pkg"

   test -e "$probe/outside/keep" && echo preserved || echo deleted
   ```

## Observed Behavior

Cleanup removes the external `outside/keep` directory and its marker file solely because that absolute path was present in the package stamp file.

`scripts/manage-bundled-workspace-deps.mjs:87` through `scripts/manage-bundled-workspace-deps.mjs:107` parse unvalidated `bundledDirs` values from the stamp file and pass each path to recursive deletion through `ensureRemoved()` at `scripts/manage-bundled-workspace-deps.mjs:44` through `scripts/manage-bundled-workspace-deps.mjs:46`.

## Expected Behavior

Cleanup should delete only canonical bundled dependency directories beneath the selected package's own `node_modules` tree, rejecting stamp entries outside that boundary.

## Impact

A tampered or externally overwritten packaging stamp can turn the normal `postpack` cleanup phase into arbitrary recursive deletion outside the package, causing destructive data loss with developer or CI privileges.
