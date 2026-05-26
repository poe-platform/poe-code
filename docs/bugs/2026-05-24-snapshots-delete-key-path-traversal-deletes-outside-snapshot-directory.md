# Snapshots delete key path traversal deletes files outside the snapshot directory

## Summary

The `snapshots delete [key]` maintenance command appends caller-supplied keys directly beneath `.snapshots` without validating that they are safe snapshot identifiers. A key containing parent-directory segments deletes a JSON file outside the snapshot directory.

## Reproduction

1. From the repository root, run this disposable working-directory probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-snapshot-delete-probe.XXXXXX)
   mkdir -p "$probe/.snapshots"
   printf 'KEEP ME\n' > "$probe/outside.json"

   (cd "$probe" && \
     "$workspace/node_modules/.bin/tsx" "$workspace/scripts/snapshots.ts" delete ../outside)

   test -e "$probe/outside.json" && echo preserved || echo deleted
   ```

## Observed Behavior

The command prints `Deleted 1 snapshot.` and deletes `outside.json`, even though the file is adjacent to `.snapshots` rather than stored inside it.

`scripts/snapshots.ts:156` through `scripts/snapshots.ts:200` pass the command-line `key` into `deleteSnapshots()`. `tests/helpers/snapshot-store.ts:164` through `tests/helpers/snapshot-store.ts:175` concatenate that unvalidated key with `snapshotDir` and unlink the derived path.

## Expected Behavior

Snapshot maintenance commands should delete only JSON snapshots canonically located within `.snapshots`. Keys containing separators or parent-directory traversal should be rejected.

## Impact

A malformed or malicious key supplied to a routine cleanup command can delete arbitrary adjacent JSON files reachable from the working directory, causing out-of-scope data loss without confirmation.
