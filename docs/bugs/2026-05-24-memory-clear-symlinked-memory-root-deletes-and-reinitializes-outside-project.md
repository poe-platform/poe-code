# Memory clear follows a symlinked memory root and deletes and reinitializes outside the project

## Summary

The `@poe-code/memory` clear operation recursively removes children beneath the resolved memory root and then recreates its scaffold without rejecting symbolic links. A symlinked project memory root causes clear to delete external memory content and rewrite external initialization files.

## Reproduction

1. From the repository root, run this disposable project-fixture probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-memory-clear-root-probe.XXXXXX)
   mkdir -p "$probe/project/.poe-code" "$probe/outside/pages"
   printf '# external index\n' > "$probe/outside/INDEX.md"
   printf 'external log\n' > "$probe/outside/LOG.md"
   printf 'remove me\n' > "$probe/outside/pages/remove.md"
   ln -s "$probe/outside" "$probe/project/.poe-code/memory"
   cat > "$probe/repro.mts" <<EOF
   import { clearMemory, resolveMemoryRoot } from "${workspace}/packages/memory/src/index.ts";
   await clearMemory(resolveMemoryRoot("${probe}/project"));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/.poe-code/memory"
   find "$probe/outside" -maxdepth 2 -print | sort
   ```

## Observed Behavior

The apparent project memory root resolves externally. Running `clearMemory()` removes the externally stored `pages/remove.md` content and leaves newly initialized external `INDEX.md`, `LOG.md`, and `pages/` entries.

`packages/memory/src/paths.ts:18` through `packages/memory/src/paths.ts:20` construct the default project root. `packages/memory/src/write.ts:56` through `packages/memory/src/write.ts:86` traverse and delete children through the unchecked root before calling `initMemory()`, which creates scaffold files through that same escaped path.

## Expected Behavior

Memory clearing should delete and recreate content only under the canonical project `.poe-code/memory` state root. A symlinked memory root escaping the project should be rejected before deletion or reinitialization.

## Impact

A crafted project or replaced memory-state entry can turn a routine cleanup operation into recursive deletion and rewriting of external data with the invoking user's privileges.
