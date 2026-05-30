---
name: "Docker repeated upload does not remove files deleted in the local workspace"
---

# Docker repeated upload does not remove files deleted in the local workspace

## Summary

The Docker execution environment uploads workspace archives by extracting them over the existing container directory. If a file present in an earlier upload is deleted locally and `uploadWorkspace()` is called again, the deleted file remains in the container workspace instead of reflecting the current local workspace.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that keeps a persistent container workspace and extracts each uploaded archive into it:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-upload-deletion-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote" "$probe/bin" "$probe/tmp"
   printf 'DELETE ME\n' > "$probe/local/deleted-locally.txt"
   printf 'KEEP V1\n' > "$probe/local/keep.txt"
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const cp = require('child_process');
   const args = process.argv.slice(2);
   const remote = process.env.DOCKER_REMOTE;
   const archive = process.env.DOCKER_UPLOAD;
   if (args.includes('run')) { process.stdout.write('container-id\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
   if (cpIndex >= 0 && args[cpIndex + 2] === 'container-id:/tmp/poe-workspace-upload.tar') {
     fs.copyFileSync(args[cpIndex + 1], archive);
     process.exit(0);
   }
   if (args.includes('exec') && args.join(' ').includes('poe-workspace-upload.tar')) {
     cp.execFileSync('tar', ['-xf', archive, '-C', remote]);
   }
   process.exit(0);
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { existsSync, rmSync } from "node:fs";
   import { readFile, writeFile } from "node:fs/promises";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const env = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local", runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   await env.uploadWorkspace();
   rmSync("${probe}/local/deleted-locally.txt");
   await writeFile("${probe}/local/keep.txt", "KEEP V2\n");
   await env.uploadWorkspace();
   console.log("deletedRemoteExists=" + existsSync("${probe}/remote/deleted-locally.txt"));
   console.log("keep=" + (await readFile("${probe}/remote/keep.txt", "utf8")).trim());
   EOF

   PATH="$probe/bin:$PATH" DOCKER_REMOTE="$probe/remote" DOCKER_UPLOAD="$probe/tmp/upload.tar" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The surviving file updates, but the file deleted locally remains in the container after the second upload:

```text
deletedRemoteExists=true
keep=KEEP V2
```

`packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:164` create and transfer each local archive, then extract it into the existing workspace with `mkdir -p ... && tar -xf ...`. The adapter never clears existing container entries first. The shared workspace uploader clears the remote workspace before writing current contents in `packages/agent-harness-tools/src/workspace-transfer.ts:121` through `packages/agent-harness-tools/src/workspace-transfer.ts:129`.

## Expected Behavior

Uploading the current local workspace again should remove paths in the container that no longer exist locally, so the container begins execution from the current uploaded workspace rather than stale leftovers from an earlier upload.

## Impact

Repeated Docker uploads can execute against deleted source files, obsolete configuration, or stale generated artifacts that the user removed locally, making container command behavior diverge from the local workspace.
