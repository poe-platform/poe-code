# Memory reconciliation follows a symlinked log file and appends external history

## Summary

The memory reconciliation log writer appends change records to `LOG.md` beneath a selected memory root without rejecting symbolic links at that file. A symlinked log entry redirects normal reconciliation history outside the memory root.

## Reproduction

1. From the repository root, run this disposable memory-root probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-memory-reconcile-link-probe.XXXXXX)
   mkdir -p "$probe/root/pages"
   printf '# Memory index\n' > "$probe/root/INDEX.md"
   printf 'EXTERNAL LOG\n' > "$probe/outside.log"
   ln -s "$probe/outside.log" "$probe/root/LOG.md"
   cat > "$probe/repro.mts" <<EOF
   import { appendLogEntries } from "${workspace}/packages/memory/src/reconcile.ts";
   await appendLogEntries("${probe}/root", {
     created: ["pages/new.md"], updated: [], deleted: []
   }, "probe reason", "2026-05-24T00:00:00.000Z");
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/root/LOG.md"
   cat "$probe/outside.log"
   ```

## Observed Behavior

The memory-facing `LOG.md` resolves externally, and appending a normal created-page change record rewrites the external log target with the additional memory history line.

`packages/memory/src/reconcile.ts:98` through `packages/memory/src/reconcile.ts:118` construct `LOG.md`, read its existing contents, and write appended change history through the unchecked path.

## Expected Behavior

Memory reconciliation history should be persisted only to a canonical `LOG.md` file inside the chosen memory root. A symlinked log file escaping that root should be rejected.

## Impact

A crafted memory root can redirect operational history into an unrelated external document, overwriting data outside memory storage and potentially exposing mutation details.
