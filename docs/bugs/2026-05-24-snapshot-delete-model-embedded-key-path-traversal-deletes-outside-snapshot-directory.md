# Snapshot model deletion trusts embedded key path traversal and deletes outside the snapshot directory

## Summary

The model-filtered snapshot deletion path reads `key` fields from existing snapshot JSON and unlinks paths derived from those embedded values without validating containment. A fixture with a traversal-bearing key causes `delete --model` behavior to delete a JSON file outside `.snapshots`.

## Reproduction

1. From the repository root, run this disposable helper-level probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-snapshot-delete-model-key-probe.XXXXXX)
   mkdir -p "$probe/project/.snapshots" "$probe/project/external"
   cat > "$probe/project/.snapshots/delete-poison.json" <<'EOF'
   {"key":"../external/delete-me","request":{"model":"delete-model","messages":[{"role":"user","content":"delete this"}]},"response":"old"}
   EOF
   printf 'DELETE TARGET\n' > "$probe/project/external/delete-me.json"
   cat > "$probe/repro.mts" <<EOF
   import * as fs from "node:fs/promises";
   import { deleteSnapshots } from "${workspace}/tests/helpers/snapshot-store.ts";
   process.chdir("${probe}/project");
   console.log(await deleteSnapshots(fs as any, ".snapshots", { model: "delete-model" }));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   test -e "$probe/project/external/delete-me.json" && echo preserved || echo deleted
   ```

## Observed Behavior

`deleteSnapshots()` reports one deletion and removes `external/delete-me.json` outside `.snapshots` because the loaded fixture's embedded key is `../external/delete-me`.

`tests/helpers/snapshot-store.ts:31` through `tests/helpers/snapshot-store.ts:56` read entries, filter them by model, and unlink paths formed from `entry.key` without checking that those paths remain beneath the snapshot directory.

## Expected Behavior

Model-filtered snapshot cleanup should unlink only canonical fixture files under `.snapshots`. Traversal-bearing embedded keys should be rejected and must not influence filesystem deletion targets.

## Impact

A malicious or corrupted snapshot fixture can cause routine model cleanup to delete adjacent JSON files outside the fixture directory, enabling destructive data loss from untrusted snapshot metadata.
