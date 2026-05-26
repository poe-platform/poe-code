# E2B refuse download omits conflicts and written files from its sync result

## Summary

The E2B execution environment implements `downloadWorkspace({ conflictPolicy: "refuse" })` by extracting an archive with `tar -xkf`, but then always returns `files: 0` and `conflicts: []`. When a local modification is preserved and a new remote file is downloaded, neither outcome is represented in the returned synchronization result.

## Reproduction

1. From the repository root, run this disposable probe. It provides a mocked E2B sandbox containing a remote workspace archive:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-download-conflict-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote"
   printf 'LOCAL MODIFIED\n' > "$probe/local/conflict.txt"
   printf 'REMOTE CHANGE\n' > "$probe/remote/conflict.txt"
   printf 'REMOTE NEW\n' > "$probe/remote/new.txt"
   tar -cf "$probe/remote.tar" -C "$probe/remote" .
   cat > "$probe/repro.mts" <<EOF
   import { readFile } from "node:fs/promises";
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   const archive = new Uint8Array(await readFile("${probe}/remote.tar"));
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { run: async () => ({ exitCode: 0 }), list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async () => archive, write: async () => {} },
     pty: { create: async () => ({ pid: 1, wait: async () => ({ exitCode: 0 }), kill: () => {} }) },
     setTimeout: async () => {}, kill: async () => {}
   };
   const env = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "${probe}/local", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   console.log("download=" + JSON.stringify(await env.downloadWorkspace({ conflictPolicy: "refuse" })));
   console.log("conflict=" + (await readFile("${probe}/local/conflict.txt", "utf8")).trim());
   console.log("new=" + (await readFile("${probe}/local/new.txt", "utf8")).trim());
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The local conflicting file is correctly preserved and the new remote file is written, but the result reports neither event:

```text
download={"files":0,"bytes":9728,"conflicts":[]}
conflict=LOCAL MODIFIED
new=REMOTE NEW
```

`packages/runner-e2b/src/opened-env.ts:107` through `packages/runner-e2b/src/opened-env.ts:132` use `tar -xkf` for refuse-mode extraction, while `packages/runner-e2b/src/opened-env.ts:133` returns fixed file and conflict lists. The shared `DownloadResult` contract exposes written file counts and local modification conflicts in `packages/process-runner/src/types.ts:94` through `packages/process-runner/src/types.ts:98`.

## Expected Behavior

Refuse-mode download should report every preserved local conflict in `conflicts` and count successfully downloaded files in `files`, rather than silently omitting synchronization outcomes.

## Impact

Users and orchestration code can be told an E2B sync completed without conflicts even though local changes blocked remote updates, while successfully downloaded files are also hidden from result metadata. This makes conflict handling and sync verification unreliable.
