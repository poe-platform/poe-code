---
name: "E2B repeated upload does not remove files deleted in the local workspace"
---

# E2B repeated upload does not remove files deleted in the local workspace

## Summary

The E2B execution environment uploads workspace archives by extracting them over the existing sandbox directory. If a file present in an earlier upload is deleted locally and `uploadWorkspace()` is called again, the deleted file remains in the sandbox workspace instead of reflecting the current local workspace.

## Reproduction

1. From the repository root, run this disposable probe. The mocked E2B sandbox extracts each uploaded archive into a persistent remote directory:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-upload-deletion-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote"
   printf 'DELETE ME\n' > "$probe/local/deleted-locally.txt"
   printf 'KEEP V1\n' > "$probe/local/keep.txt"
   cat > "$probe/repro.mts" <<EOF
   import { execFileSync } from "node:child_process";
   import { existsSync, rmSync } from "node:fs";
   import { readFile, writeFile } from "node:fs/promises";
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const uploadArchive = "${probe}/upload.tar";
   const remoteDir = "${probe}/remote";
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { run: async (command: string) => { if (command.includes("poe-workspace-upload.tar")) execFileSync("tar", ["-xf", uploadArchive, "-C", remoteDir]); return { exitCode: 0 }; }, list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async () => new Uint8Array(), write: async (_path: string, content: ArrayBuffer) => { await writeFile(uploadArchive, Buffer.from(content)); } },
     pty: { create: async () => ({}) }, kill: async () => {}, setTimeout: async () => {}, getInfo: async () => ({})
   } as any;
   const env = createOpenedE2bEnv({
     sandbox,
     spec: { cwd: "${probe}/local", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any,
     runtime: { type: "e2b" } as any
   });
   await env.uploadWorkspace();
   rmSync("${probe}/local/deleted-locally.txt");
   await writeFile("${probe}/local/keep.txt", "KEEP V2\n");
   await env.uploadWorkspace();
   console.log("deletedRemoteExists=" + existsSync("${probe}/remote/deleted-locally.txt"));
   console.log("keep=" + (await readFile("${probe}/remote/keep.txt", "utf8")).trim());
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The surviving file updates, but the file deleted locally remains in the sandbox after the second upload:

```text
deletedRemoteExists=true
keep=KEEP V2
```

`packages/runner-e2b/src/opened-env.ts:74` through `packages/runner-e2b/src/opened-env.ts:102` create and transfer each local archive. Its remote extraction command in `packages/runner-e2b/src/opened-env.ts:447` through `packages/runner-e2b/src/opened-env.ts:452` only creates the sandbox directory and extracts over it; it never removes existing entries first. The shared workspace uploader clears the remote workspace before writing current contents in `packages/agent-harness-tools/src/workspace-transfer.ts:121` through `packages/agent-harness-tools/src/workspace-transfer.ts:129`.

## Expected Behavior

Uploading the current local workspace again should remove paths in the sandbox that no longer exist locally, so the sandbox begins execution from the current uploaded workspace rather than stale leftovers from an earlier upload.

## Impact

Repeated E2B uploads can execute against deleted source files, obsolete configuration, or stale generated artifacts that the user removed locally, making remote command behavior diverge from the local workspace.
