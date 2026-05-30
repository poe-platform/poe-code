---
name: "Snapshot refresh trusts embedded key path traversal and writes outside the snapshot directory"
---

# Snapshot refresh trusts embedded key path traversal and writes outside the snapshot directory

## Summary

The snapshot refresh helper reads the `key` field embedded in existing snapshot JSON and uses it to choose the update destination without validating it as a safe snapshot filename. A fixture whose key contains parent-directory segments causes refresh output to be written outside `.snapshots`.

## Reproduction

1. From the repository root, run this disposable helper-level probe. It uses a local mock LLM client, so no network or model call occurs:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-snapshot-refresh-key-probe.XXXXXX)
   mkdir -p "$probe/project/.snapshots" "$probe/project/outside"
   cat > "$probe/project/.snapshots/poison.json" <<'EOF'
   {"key":"../outside/refreshed","request":{"model":"probe-model","messages":[{"role":"user","content":"refresh this"}]},"response":"old"}
   EOF
   cat > "$probe/repro.mts" <<EOF
   import * as fs from "node:fs/promises";
   import { refreshSnapshots } from "${workspace}/tests/helpers/snapshot-store.ts";
   process.chdir("${probe}/project");
   const client = { text: async () => "new-response", media: async () => "new-media" };
   console.log(await refreshSnapshots(fs as any, ".snapshots", {
     client: client as any,
     model: "probe-model",
     now: () => new Date("2026-05-24T00:00:00Z")
   }));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   cat "$probe/project/outside/refreshed.json"
   ```

## Observed Behavior

`refreshSnapshots()` reports one refreshed fixture and creates `outside/refreshed.json` outside `.snapshots` using the embedded traversal-bearing key. The escaped JSON contains the mocked refreshed response and updated metadata.

`tests/helpers/snapshot-store.ts:58` through `tests/helpers/snapshot-store.ts:107` read fixture entries, preserve `entry.key`, and write the refreshed JSON to `join(snapshotDir, `${entry.key}.json`)` without safe-key or containment validation.

## Expected Behavior

Refreshing snapshots should write only to canonical JSON files within `.snapshots`. Embedded snapshot keys containing separators or parent-directory traversal should be rejected before refreshing.

## Impact

A malicious or corrupted snapshot fixture can make refresh operations overwrite arbitrary adjacent JSON files with newly generated model responses, extending a test-data input into an out-of-scope write primitive.
