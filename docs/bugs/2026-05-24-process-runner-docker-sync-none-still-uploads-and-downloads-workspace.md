# Docker runner sync none still uploads and downloads workspace content

## Summary

The runner configuration supports `sync: "none"` to disable workspace synchronization, and the E2B backend honors that mode. The Docker execution environment does not inspect `runner.sync`, so it still transfers local workspace files into the container and downloads remote files back into the local project.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that records upload archive contents and supplies a download archive:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-sync-none-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote" "$probe/bin"
   printf 'LOCAL UPLOAD\n' > "$probe/local/local.txt"
   printf 'REMOTE DOWNLOAD\n' > "$probe/remote/from-remote.txt"
   tar -cf "$probe/remote.tar" -C "$probe/remote" .
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const { execFileSync } = require('child_process');
   const args = process.argv.slice(2);
   if (args.includes('run')) { process.stdout.write('container-id\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
   if (cpIndex >= 0 && args[cpIndex + 2] === 'container-id:/tmp/poe-workspace-upload.tar') {
     fs.writeFileSync(process.env.UPLOAD_LOG, execFileSync('tar', ['-tf', args[cpIndex + 1]], { encoding: 'utf8' }));
   }
   if (cpIndex >= 0 && args[cpIndex + 1] === 'container-id:/tmp/poe-workspace-download.tar') {
     fs.copyFileSync(process.env.REMOTE_ARCHIVE, args[cpIndex + 2]);
   }
   process.exit(0);
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { readFile } from "node:fs/promises";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const env = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local", runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "none" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   await env.uploadWorkspace();
   await env.downloadWorkspace({ conflictPolicy: "overwrite" });
   console.log("downloaded=" + (await readFile("${probe}/local/from-remote.txt", "utf8")).trim());
   EOF

   PATH="$probe/bin:$PATH" UPLOAD_LOG="$probe/upload.log" REMOTE_ARCHIVE="$probe/remote.tar" \
     "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   cat "$probe/upload.log"
   ```

## Observed Behavior

With `runner: { sync: "none" }`, the upload archive contains the local file and the remote file is still written locally:

```text
downloaded=REMOTE DOWNLOAD
./local.txt
```

`packages/runner-e2b/src/opened-env.ts:74` through `packages/runner-e2b/src/opened-env.ts:109` explicitly skip transfers for `sync: "none"`, but `packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:208` perform uploads and downloads without consulting `input.spec.runner?.sync`.

## Expected Behavior

Docker execution with `runner.sync` set to `"none"` should perform no workspace upload or download operations, consistently with the configured synchronization mode.

## Impact

Users who disable synchronization can still send local project content into Docker environments and receive remote modifications into their working tree, violating an explicit data-transfer configuration boundary.
