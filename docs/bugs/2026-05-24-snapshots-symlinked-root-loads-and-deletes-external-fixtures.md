---
name: "Snapshots command follows a symlinked snapshot root and loads and deletes external fixtures"
---

# Snapshots command follows a symlinked snapshot root and loads and deletes external fixtures

## Summary

The standalone snapshots maintenance command treats the working-directory-relative `.snapshots` path as its fixture root without rejecting symbolic links. A symlinked `.snapshots` directory allows listing externally supplied fixture contents and deleting those external files via normal command options.

## Reproduction

1. From the repository root, run this disposable working-directory probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-snapshot-root-probe.XXXXXX)
   mkdir -p "$probe/external"
   ln -s "$probe/external" "$probe/.snapshots"
   cat > "$probe/external/external.json" <<'EOF'
   {"key":"external","request":{"model":"probe-model","messages":[{"role":"user","content":"external prompt"}]},"response":"external"}
   EOF

   (cd "$probe" && "$workspace/node_modules/.bin/tsx" "$workspace/scripts/snapshots.ts" list)
   (cd "$probe" && "$workspace/node_modules/.bin/tsx" "$workspace/scripts/snapshots.ts" delete --model probe-model)

   test -e "$probe/external/external.json" && echo preserved || echo deleted
   ```

## Observed Behavior

The `list` command displays the externally stored fixture as `external | probe-model | external prompt |`. The subsequent model-filtered `delete` reports `Deleted 1 snapshot.` and removes the external JSON file through the symlinked `.snapshots` root.

`scripts/snapshots.ts:96` through `scripts/snapshots.ts:134` and `scripts/snapshots.ts:156` through `scripts/snapshots.ts:200` pass the fixed `.snapshots` root into maintenance operations. `tests/helpers/snapshot-store.ts:15` through `tests/helpers/snapshot-store.ts:56` and `tests/helpers/snapshot-store.ts:113` through `tests/helpers/snapshot-store.ts:142` read and delete directly beneath that unchecked root.

## Expected Behavior

Snapshot maintenance should operate only on fixtures canonically contained within the current workspace's `.snapshots` directory. A symlinked root escaping the workspace should be rejected before reads or deletions.

## Impact

A crafted workspace can feed external fixture contents into snapshot-maintenance output and use routine cleanup operations to delete external JSON files, affecting confidentiality and integrity outside the project boundary.
