# Snapshot operations follow a symlinked fixture file and load and overwrite an external response

## Summary

The snapshot helper reads and refreshes individual JSON entries beneath `.snapshots` without rejecting symbolic links at the fixture-file level. A workspace-local-looking fixture link causes external snapshot contents to be listed and then overwritten during refresh.

## Reproduction

1. From the repository root, run this disposable helper-level probe. It uses a local mock LLM client, so no network or model call occurs:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-snapshot-file-link-probe.XXXXXX)
   mkdir -p "$probe/project/.snapshots" "$probe/project/external"
   cat > "$probe/project/external/probe.json" <<'EOF'
   {"key":"probe","request":{"model":"probe-model","messages":[{"role":"user","content":"external prompt"}]},"response":"external-old"}
   EOF
   ln -s "$probe/project/external/probe.json" "$probe/project/.snapshots/probe.json"
   cat > "$probe/repro.mts" <<EOF
   import * as fs from "node:fs/promises";
   import { listSnapshots, refreshSnapshots } from "${workspace}/tests/helpers/snapshot-store.ts";
   process.chdir("${probe}/project");
   console.log(JSON.stringify(await listSnapshots(fs as any, ".snapshots")));
   const client = { text: async () => "refreshed-external", media: async () => "unused" };
   console.log(await refreshSnapshots(fs as any, ".snapshots", {
     client: client as any,
     model: "probe-model",
     now: () => new Date("2026-05-24T00:00:00Z")
   }));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   cat "$probe/project/external/probe.json"
   ```

## Observed Behavior

The list operation displays a snapshot request loaded from the external JSON target, and refresh subsequently overwrites that same external file with `refreshed-external` and new metadata through the `.snapshots/probe.json` symlink.

`tests/helpers/snapshot-store.ts:15` through `tests/helpers/snapshot-store.ts:28` list parsed fixtures, `tests/helpers/snapshot-store.ts:58` through `tests/helpers/snapshot-store.ts:107` refresh them, and `tests/helpers/snapshot-store.ts:113` through `tests/helpers/snapshot-store.ts:142` read JSON entries without rejecting a symlinked fixture file.

## Expected Behavior

Snapshot reads and refreshes should operate only on canonical fixture files contained within `.snapshots`. Individual fixture symlinks escaping the workspace should be rejected.

## Impact

A crafted workspace can inject externally controlled playback/request data into snapshot management and cause refresh workflows to overwrite external JSON files with new response content.
