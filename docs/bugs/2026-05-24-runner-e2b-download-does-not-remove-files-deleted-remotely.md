---
name: "E2B download does not remove files deleted in the remote workspace"
---

# E2B download does not remove files deleted in the remote workspace

## Summary

The E2B execution environment downloads a remote workspace by extracting a tar archive over the local directory. Files that were uploaded initially and later deleted inside the remote workspace remain on disk locally after `downloadWorkspace({ conflictPolicy: "overwrite" })`, so synchronization is additive instead of mirroring the remote workspace.

## Reproduction

1. From the repository root, run this disposable probe. The mocked sandbox observes the initial upload and then returns a remote archive where `deleted-remotely.txt` no longer exists:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-download-deletion-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote"
   printf 'ORIGINAL FILE\n' > "$probe/local/deleted-remotely.txt"
   printf 'REMOTE NEW\n' > "$probe/remote/new.txt"
   tar -cf "$probe/remote.tar" -C "$probe/remote" .
   cat > "$probe/repro.mts" <<EOF
   import { existsSync } from "node:fs";
   import { readFile } from "node:fs/promises";
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const remoteArchive = new Uint8Array(await readFile("${probe}/remote.tar"));
   let uploadObserved = false;
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { run: async () => ({ exitCode: 0 }), list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async () => remoteArchive, write: async () => { uploadObserved = true; } },
     pty: { create: async () => ({}) }, kill: async () => {}, setTimeout: async () => {}, getInfo: async () => ({})
   } as any;
   const env = createOpenedE2bEnv({
     sandbox,
     spec: { cwd: "${probe}/local", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any,
     runtime: { type: "e2b" } as any
   });
   await env.uploadWorkspace();
   console.log("uploaded=" + uploadObserved);
   console.log("download=" + JSON.stringify(await env.downloadWorkspace({ conflictPolicy: "overwrite" })));
   console.log("deletedExists=" + existsSync("${probe}/local/deleted-remotely.txt"));
   console.log("new=" + (await readFile("${probe}/local/new.txt", "utf8")).trim());
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The new remote file downloads, but the locally stale file that was removed remotely still exists:

```text
uploaded=true
download={"files":0,"bytes":6656,"conflicts":[]}
deletedExists=true
new=REMOTE NEW
```

`packages/runner-e2b/src/opened-env.ts:74` through `packages/runner-e2b/src/opened-env.ts:102` upload the original workspace, while `packages/runner-e2b/src/opened-env.ts:107` through `packages/runner-e2b/src/opened-env.ts:133` download by extracting the remote archive over the local directory without tracking or removing absent remote paths. By contrast, the shared transfer implementation deletes uploaded paths absent remotely in `packages/agent-harness-tools/src/workspace-transfer.ts:181` through `packages/agent-harness-tools/src/workspace-transfer.ts:198`.

## Expected Behavior

After overwrite-mode synchronization, a local file that originated in the uploaded workspace and was deleted remotely should also be removed locally, matching the documented behavior to mirror the remote workspace back.

## Impact

Users can sync completed E2B jobs and unknowingly keep files that the remote command intentionally deleted, leaving the local project in a stale or incorrect state.
