# E2B workspace upload ignores the documented maximum file-size policy

## Summary

The E2B runner configuration documents `upload_max_file_mb` as the maximum file size uploaded during workspace transfer, but `createOpenedE2bEnv().uploadWorkspace()` archives and uploads the workspace without applying that setting. A file larger than a valid configured limit is still transferred.

## Reproduction

1. From the repository root, run this disposable probe. It uses a mocked E2B sandbox, creates a 2 KiB file, and sets the valid positive limit `upload_max_file_mb: 0.001` (approximately 1 KiB):

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2b-upload-limit-probe.XXXXXX)
   mkdir -p "$probe/local"
   dd if=/dev/zero of="$probe/local/large.bin" bs=2048 count=1 status=none
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
     spec: { cwd: "${probe}/local", runtime: { type: "e2b" }, runner: { sync: "both", upload_max_file_mb: 0.001 }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] } } as any
   });
   console.log("result=" + JSON.stringify(await env.uploadWorkspace()));
   console.log("uploadedArchiveBytes=" + uploadedArchiveBytes);
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The 2 KiB file is included in and transferred as a non-empty archive despite a valid approximately 1 KiB upload maximum:

```text
result={"files":0,"bytes":0,"skipped":[]}
uploadedArchiveBytes=6656
```

`packages/runner-e2b/README.md:45` through `packages/runner-e2b/README.md:50` document `upload_max_file_mb`, but `packages/runner-e2b/src/opened-env.ts:74` through `packages/runner-e2b/src/opened-env.ts:102` only apply `uploadIgnoreFiles` while creating the archive and never inspect the size-limit setting.

## Expected Behavior

E2B uploads should apply `upload_max_file_mb`, omit oversized files from transferred workspace content, and identify them in the returned `skipped` list.

## Impact

Large files that operators explicitly configured the runner not to upload can still be transferred into E2B sandboxes, increasing data exposure, upload time, and remote storage usage while falsely reporting that nothing was skipped.
