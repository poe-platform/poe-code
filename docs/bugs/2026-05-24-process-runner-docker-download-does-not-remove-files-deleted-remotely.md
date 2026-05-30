---
name: "Docker download does not remove files deleted in the remote workspace"
---

# Docker download does not remove files deleted in the remote workspace

## Summary

The Docker execution environment downloads a remote workspace by extracting a tar archive over the local directory. Files that were uploaded initially and later deleted inside the container remain on disk locally after `downloadWorkspace({ conflictPolicy: "overwrite" })`, so synchronization is additive instead of mirroring the container workspace.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable. The local workspace is uploaded first; the fake container download then supplies an archive where `deleted-remotely.txt` no longer exists:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-download-deletion-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote" "$probe/bin"
   printf 'ORIGINAL FILE\n' > "$probe/local/deleted-remotely.txt"
   printf 'REMOTE NEW\n' > "$probe/remote/new.txt"
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
   import { existsSync } from "node:fs";
   import { readFile } from "node:fs/promises";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const env = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local", runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   await env.uploadWorkspace();
   console.log("uploaded=true");
   console.log("download=" + JSON.stringify(await env.downloadWorkspace({ conflictPolicy: "overwrite" })));
   console.log("deletedExists=" + existsSync("${probe}/local/deleted-remotely.txt"));
   console.log("new=" + (await readFile("${probe}/local/new.txt", "utf8")).trim());
   EOF

   PATH="$probe/bin:$PATH" REMOTE_ARCHIVE="$probe/remote.tar" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The new container file downloads, but the locally stale file that was removed in the container still exists:

```text
uploaded=true
download={"files":0,"bytes":0,"conflicts":[]}
deletedExists=true
new=REMOTE NEW
```

`packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:164` upload the original workspace, while `packages/process-runner/src/docker/docker-execution-env.ts:169` through `packages/process-runner/src/docker/docker-execution-env.ts:205` download by extracting the remote archive over the local directory without tracking or removing absent remote paths. By contrast, the shared transfer implementation deletes uploaded paths absent remotely in `packages/agent-harness-tools/src/workspace-transfer.ts:181` through `packages/agent-harness-tools/src/workspace-transfer.ts:198`.

## Expected Behavior

After overwrite-mode synchronization, a local file that originated in the uploaded workspace and was deleted in the container should also be removed locally, matching the documented behavior to mirror the remote workspace back.

## Impact

Users can sync completed Docker jobs and unknowingly keep files that the container command intentionally deleted, leaving the local project in a stale or incorrect state.
