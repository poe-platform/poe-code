# Memory clear follows a symlinked child directory and deletes external content before erroring

## Summary

The `@poe-code/memory` clear operation recursively traverses child entries beneath a real memory root using `stat()`, which follows directory symlinks. A symlinked child directory under `pages/` causes clear to delete external files before it fails while attempting to remove the symlink as a directory.

## Reproduction

1. From the repository root, run this disposable memory-root probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-memory-clear-child-probe.XXXXXX)
   mkdir -p "$probe/root/pages" "$probe/outside"
   printf '# index\n' > "$probe/root/INDEX.md"
   printf 'log\n' > "$probe/root/LOG.md"
   printf 'delete external\n' > "$probe/outside/secret.md"
   ln -s "$probe/outside" "$probe/root/pages/linked"
   cat > "$probe/repro.mts" <<EOF
   import { clearMemory } from "${workspace}/packages/memory/src/write.ts";
   await clearMemory("${probe}/root");
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts" || true
   find "$probe/outside" -maxdepth 1 -print | sort
   ```

## Observed Behavior

`clearMemory()` throws `ENOTDIR` while trying to remove `root/pages/linked`, but before throwing it has already followed that symlink and deleted the external `outside/secret.md` file.

`packages/memory/src/write.ts:56` through `packages/memory/src/write.ts:86` recursively enumerate children, call `stat()` on each entry, traverse entries whose resolved targets are directories, and unlink files without rejecting symbolic-link escapes.

## Expected Behavior

Memory clearing should delete only entries canonically contained within the selected memory root. Symlinked descendants escaping that root should be skipped or rejected before any external contents are traversed or removed.

## Impact

A crafted memory pages tree can cause a routine clear operation to destructively delete external files even though the operation ultimately fails and does not complete reinitialization.
