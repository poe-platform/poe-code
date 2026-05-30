---
name: "Docker workspace upload reports zero files and bytes after transferring content"
---

# Docker workspace upload reports zero files and bytes after transferring content

## Summary

The Docker execution environment archives and copies the local workspace into its container, but `uploadWorkspace()` always returns `{ files: 0, bytes: 0, skipped: [] }` even when the transferred archive contains workspace files. Callers cannot observe non-empty Docker uploads through the shared transfer result contract.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that records the copied archive contents:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-upload-result-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/bin"
   printf 'uploaded bytes\n' > "$probe/local/upload.txt"
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const { execFileSync } = require('child_process');
   const args = process.argv.slice(2);
   if (args.includes('run')) { process.stdout.write('container-id\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
   if (cpIndex >= 0 && args[cpIndex + 2] === 'container-id:/tmp/poe-workspace-upload.tar') {
     const source = args[cpIndex + 1];
     fs.writeFileSync(process.env.DOCKER_LOG, `upload_bytes=${fs.statSync(source).size}\n${execFileSync('tar', ['-tf', source], { encoding: 'utf8' })}`);
   }
   process.exit(0);
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const env = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local", runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   console.log("result=" + JSON.stringify(await env.uploadWorkspace()));
   EOF

   PATH="$probe/bin:$PATH" DOCKER_LOG="$probe/docker.log" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   cat "$probe/docker.log"
   ```

## Observed Behavior

The fake Docker destination receives an archive containing `upload.txt`, but the operation reports zero transferred data:

```text
result={"files":0,"bytes":0,"skipped":[]}
upload_bytes=...
./upload.txt
```

`packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:162` create and copy the workspace archive, while `packages/process-runner/src/docker/docker-execution-env.ts:164` returns fixed zero counters. The shared `UploadResult` contract exposes `files`, `bytes`, and `skipped` in `packages/process-runner/src/types.ts:88` through `packages/process-runner/src/types.ts:92`.

## Expected Behavior

After transferring workspace content, Docker `uploadWorkspace()` should report actual uploaded file and byte totals, together with any skipped inputs.

## Impact

Callers and user-facing runtime status cannot distinguish a successful non-empty Docker upload from an empty or skipped transfer, undermining synchronization verification and accounting.
