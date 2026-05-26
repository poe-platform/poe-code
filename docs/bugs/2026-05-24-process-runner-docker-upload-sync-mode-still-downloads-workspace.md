# Docker runner upload sync mode still downloads workspace content

## Summary

The runner configuration accepts `sync: "upload"` to transfer local workspace content into the runtime without downloading remote changes back. The Docker execution environment never inspects `runner.sync`, so `downloadWorkspace()` still writes remote files into the local project in upload-only mode.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that provides a controlled download archive:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-upload-only-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote" "$probe/bin"
   printf 'LOCAL UPLOAD\n' > "$probe/local/local.txt"
   printf 'REMOTE SHOULD NOT DOWNLOAD\n' > "$probe/remote/from-remote.txt"
   tar -cf "$probe/remote.tar" -C "$probe/remote" .
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const args = process.argv.slice(2);
   if (args.includes('run')) { process.stdout.write('container-id\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
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
     runner: { sync: "upload" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   console.log(JSON.stringify(await env.downloadWorkspace({ conflictPolicy: "overwrite" })));
   console.log((await readFile("${probe}/local/from-remote.txt", "utf8")).trim());
   EOF

   PATH="$probe/bin:$PATH" REMOTE_ARCHIVE="$probe/remote.tar" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The remote file is downloaded into the local project even though the runner is configured for upload-only synchronization:

```text
{"files":0,"bytes":0,"conflicts":[]}
REMOTE SHOULD NOT DOWNLOAD
```

`packages/poe-code-config/src/runtime.ts:404` through `packages/poe-code-config/src/runtime.ts:411` define `"upload"` as an accepted synchronization mode, and `packages/runner-e2b/src/opened-env.ts:107` through `packages/runner-e2b/src/opened-env.ts:109` skip downloads for it. In contrast, `packages/process-runner/src/docker/docker-execution-env.ts:169` through `packages/process-runner/src/docker/docker-execution-env.ts:208` download and extract content without inspecting `input.spec.runner?.sync`.

## Expected Behavior

Docker execution with `runner.sync` set to `"upload"` should upload local content as configured but skip all remote-to-local download operations.

## Impact

Users who configure upload-only Docker execution can still have remote runtime files written into their working tree, violating the selected synchronization direction and unexpectedly modifying local project content.
