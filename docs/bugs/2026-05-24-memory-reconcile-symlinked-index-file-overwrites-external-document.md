# Memory reconciliation follows a symlinked index file and overwrites an external document

## Summary

The memory reconciliation workflow regenerates `INDEX.md` beneath a selected memory root without rejecting a symbolic link at the index file. A symlinked index entry redirects the generated memory index to an external Markdown document.

## Reproduction

1. From the repository root, run this disposable memory-root probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-memory-index-link-probe.XXXXXX)
   mkdir -p "$probe/root/pages"
   printf '# page\n' > "$probe/root/pages/page.md"
   printf 'external index\n' > "$probe/outside.md"
   ln -s "$probe/outside.md" "$probe/root/INDEX.md"
   printf '' > "$probe/root/LOG.md"
   cat > "$probe/repro.mts" <<EOF
   import { reconcile } from "${workspace}/packages/memory/src/reconcile.ts";
   await reconcile("${probe}/root", { pages: {} }, "update", "probe");
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/root/INDEX.md"
   cat "$probe/outside.md"
   ```

## Observed Behavior

The memory-facing `INDEX.md` resolves externally, and reconciliation overwrites the external Markdown target with the generated memory index referencing `pages/page.md`.

`packages/memory/src/reconcile.ts:73` through `packages/memory/src/reconcile.ts:75` invoke index generation as part of normal reconciliation, and the index writer at `packages/memory/src/reconcile.ts:137` through `packages/memory/src/reconcile.ts:146` writes `INDEX.md` through the unchecked path.

## Expected Behavior

Reconciliation should write generated indexes only to canonical `INDEX.md` files within the selected memory root. A symlinked index file escaping that root should be rejected.

## Impact

A crafted memory state tree can cause routine writes or reconciliation to overwrite an unrelated external Markdown file with generated memory index content.
