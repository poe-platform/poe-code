# Docker workspace upload ignores the configured maximum file-size policy

## Summary

The shared runner configuration exposes `upload_max_file_mb` to limit uploaded workspace files, but the Docker execution environment creates and transfers an archive without applying that value. A file larger than a valid configured limit is still uploaded.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that inspects the uploaded archive. It creates a 2 KiB file and configures the valid positive limit `upload_max_file_mb: 0.001` (approximately 1 KiB):

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-upload-limit-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/bin"
   dd if=/dev/zero of="$probe/local/large.bin" bs=2048 count=1 status=none
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const { execFileSync } = require('child_process');
   const args = process.argv.slice(2);
   if (args.includes('run')) { process.stdout.write('container-id\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
   if (cpIndex >= 0 && args[cpIndex + 2] === 'container-id:/tmp/poe-workspace-upload.tar') {
     const source = args[cpIndex + 1];
     fs.writeFileSync(process.env.DOCKER_LOG, execFileSync('tar', ['-tf', source], { encoding: 'utf8' }));
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
     runner: { sync: "both", upload_max_file_mb: 0.001 }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   console.log(JSON.stringify(await env.uploadWorkspace()));
   EOF

   PATH="$probe/bin:$PATH" DOCKER_LOG="$probe/docker.log" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   cat "$probe/docker.log"
   ```

## Observed Behavior

Despite a valid approximately 1 KiB maximum, the transferred archive contains the 2 KiB file:

```text
{"files":0,"bytes":0,"skipped":[]}
./large.bin
```

`packages/agent-harness-tools/src/poe-command-execution.ts:60` through `packages/agent-harness-tools/src/poe-command-execution.ts:67` pass the runner configuration into execution, but `packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:164` only apply ignore patterns and never inspect `upload_max_file_mb`.

## Expected Behavior

Docker uploads should apply `upload_max_file_mb`, exclude oversized files from the transferred archive, and identify them in the returned `skipped` result.

## Impact

Files operators configured the runner not to upload can still be copied into Docker environments, increasing unintended data transfer while result metadata falsely states that nothing was skipped.
