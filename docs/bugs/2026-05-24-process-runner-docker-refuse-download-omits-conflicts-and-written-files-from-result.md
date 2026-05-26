# Docker refuse download omits conflicts and written files from its sync result

## Summary

The Docker execution environment implements `downloadWorkspace({ conflictPolicy: "refuse" })` by extracting the container archive with keep-existing behavior, but always returns `files: 0` and `conflicts: []`. A preserved local modification and a successfully downloaded remote file are both omitted from the reported synchronization result.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that supplies a remote workspace archive:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-download-conflict-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/remote" "$probe/bin"
   printf 'LOCAL MODIFIED\n' > "$probe/local/conflict.txt"
   printf 'REMOTE CHANGE\n' > "$probe/remote/conflict.txt"
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
   import { readFile } from "node:fs/promises";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const env = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local", runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   console.log("download=" + JSON.stringify(await env.downloadWorkspace({ conflictPolicy: "refuse" })));
   console.log("conflict=" + (await readFile("${probe}/local/conflict.txt", "utf8")).trim());
   console.log("new=" + (await readFile("${probe}/local/new.txt", "utf8")).trim());
   EOF

   PATH="$probe/bin:$PATH" REMOTE_ARCHIVE="$probe/remote.tar" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The local conflicting file remains unchanged and the new remote file is written, but neither is reported:

```text
download={"files":0,"bytes":0,"conflicts":[]}
conflict=LOCAL MODIFIED
new=REMOTE NEW
```

`packages/process-runner/src/docker/docker-execution-env.ts:169` through `packages/process-runner/src/docker/docker-execution-env.ts:205` perform refuse-mode extraction using `tar -xkf`, while `packages/process-runner/src/docker/docker-execution-env.ts:207` returns fixed file and conflict lists. The shared `DownloadResult` contract exposes written file counts and local modification conflicts in `packages/process-runner/src/types.ts:94` through `packages/process-runner/src/types.ts:98`.

## Expected Behavior

Docker refuse-mode download should report preserved local conflicts and count successfully downloaded remote files in its returned `DownloadResult`.

## Impact

Users and automation can receive a conflict-free Docker synchronization result despite local updates being skipped, and cannot observe which new files were actually downloaded.
