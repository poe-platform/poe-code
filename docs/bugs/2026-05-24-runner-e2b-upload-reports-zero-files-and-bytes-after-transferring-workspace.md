# E2B workspace upload reports zero files and bytes after transferring content

## Summary

The E2B execution environment archives and uploads the local workspace, but `uploadWorkspace()` always returns `{ files: 0, bytes: 0, skipped: [] }` even when it transferred non-empty workspace content. Callers cannot observe how much data was uploaded through the shared transfer result contract.

## Reproduction

1. From the repository root, run this disposable probe. It uses a mocked E2B sandbox, while the local archive creation remains real:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-upload-result-probe.XXXXXX)
   mkdir -p "$probe/local"
   printf 'uploaded bytes\n' > "$probe/local/upload.txt"
   cat > "$probe/repro.mts" <<EOF
   import { createOpenedE2bEnv } from "${workspace}/packages/runner-e2b/src/opened-env.ts";
   let uploadedArchiveBytes = 0;
   const sandbox = {
     sandboxId: "sb_probe",
     commands: { run: async () => ({ exitCode: 0 }), list: async () => [], connect: async () => ({}), sendStdin: async () => {}, closeStdin: async () => {}, kill: async () => {} },
     files: { read: async () => new Uint8Array(), write: async (_path: string, data: ArrayBuffer) => { uploadedArchiveBytes = data.byteLength; } },
     pty: { create: async () => ({ pid: 1, wait: async () => ({ exitCode: 0 }), kill: () => {} }) },
     setTimeout: async () => {}, kill: async () => {}
   };
   const env = createOpenedE2bEnv({
     sandbox: sandbox as any,
     runtime: { type: "e2b", build_args: {}, mounts: [], workspace_dir: "/workspace", preserve_after_exit_hours: 24 } as any,
     spec: { cwd: "${probe}/local", runtime: { type: "e2b" }, runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   console.log("result=" + JSON.stringify(await env.uploadWorkspace()));
   console.log("uploadedArchiveBytes=" + uploadedArchiveBytes);
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The probe transfers a non-empty archive but reports no uploaded files or bytes:

```text
result={"files":0,"bytes":0,"skipped":[]}
uploadedArchiveBytes=6656
```

`packages/runner-e2b/src/opened-env.ts:74` through `packages/runner-e2b/src/opened-env.ts:101` create and upload the archive, while `packages/runner-e2b/src/opened-env.ts:102` returns fixed zero counters. The shared `UploadResult` contract exposes `files`, `bytes`, and `skipped` in `packages/process-runner/src/types.ts:88` through `packages/process-runner/src/types.ts:92`.

## Expected Behavior

After transferring workspace content, `uploadWorkspace()` should report the actual number of uploaded files and bytes, together with any skipped inputs, consistently with the shared result type.

## Impact

Callers and user-facing runtime status cannot distinguish a successful non-empty E2B workspace upload from an empty or skipped transfer, undermining sync observability and any accounting based on returned upload metadata.
