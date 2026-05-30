---
name: "Docker workspace upload includes gitignored and Poe-Code-ignored files"
---

# Docker workspace upload includes gitignored and Poe-Code-ignored files

## Summary

The shared workspace-transfer implementation and runtime design specify that uploads apply `.gitignore` and additive `.poe-code-ignore` exclusions. The Docker execution environment instead creates a raw `tar` archive using only configured `runner.workspace.exclude` patterns, so files ignored by either project ignore file are still copied into the container.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that saves the uploaded archive locally:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-ignore-upload-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/bin"
   printf 'secret.env\n' > "$probe/local/.gitignore"
   printf 'ignored-by-poe.txt\n' > "$probe/local/.poe-code-ignore"
   printf 'SECRET DOCKER\n' > "$probe/local/secret.env"
   printf 'PRIVATE DOCKER\n' > "$probe/local/ignored-by-poe.txt"
   cat > "$probe/bin/docker" <<'EOF'
   #!/usr/bin/env node
   const fs = require('fs');
   const args = process.argv.slice(2);
   if (args.includes('run')) { process.stdout.write('container-id\n'); process.exit(0); }
   const cpIndex = args.indexOf('cp');
   if (cpIndex >= 0 && args[cpIndex + 2] === 'container-id:/tmp/poe-workspace-upload.tar') {
     fs.copyFileSync(args[cpIndex + 1], process.env.DOCKER_TAR);
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
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [".git", "node_modules", "dist"], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   await env.uploadWorkspace();
   EOF

   PATH="$probe/bin:$PATH" DOCKER_TAR="$probe/uploaded.tar" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   tar -tf "$probe/uploaded.tar"
   ```

## Observed Behavior

The uploaded Docker archive contains both files that project ignore rules designate for exclusion:

```text
./ignored-by-poe.txt
./secret.env
```

`packages/agent-harness-tools/src/workspace-transfer.ts:82` through `packages/agent-harness-tools/src/workspace-transfer.ts:112` implement `.gitignore` and `.poe-code-ignore` filtering, and `docs/plans/archive/e2b-integration.md:903` through `docs/plans/archive/e2b-integration.md:910` specify that both remote backends use it. However, `packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:164` invoke `tar` with only `input.spec.uploadIgnoreFiles` exclusions and never read either ignore file.

## Expected Behavior

Docker workspace uploads should omit files matched by `.gitignore` and additive `.poe-code-ignore` rules before copying workspace data into the container.

## Impact

Project files intentionally excluded from transfer, including gitignored secrets or local-only artifacts, can be copied into Docker runtime environments unexpectedly.
