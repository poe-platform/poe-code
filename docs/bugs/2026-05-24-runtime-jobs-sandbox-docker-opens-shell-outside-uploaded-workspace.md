---
name: "Docker runtime jobs sandbox opens a shell outside the uploaded workspace"
---

# Docker runtime jobs sandbox opens a shell outside the uploaded workspace

## Summary

Docker runtime environments upload the local workspace into the container path matching the caller's local `cwd`. The `runtime jobs sandbox` command attaches using only an environment ID, so the Docker adapter builds an attached environment with its default `/workspace` directory. For jobs launched from any other local path, the interactive sandbox shell starts outside the directory containing the uploaded project.

## Reproduction

1. From the repository root, run this disposable probe with fake Docker executables that record the container commands issued by opening, uploading, and sandbox attachment:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-sandbox-cwd-probe.XXXXXX)
   mkdir -p "$probe/custom-project" "$probe/bin"
   : > "$probe/calls.log"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then printf 'docker version\n'; exit 0; fi
   if [ "$1" = "run" ]; then printf 'container-id\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const opened = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/custom-project", runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   await opened.uploadWorkspace();
   const sandbox = await dockerExecutionEnvFactory.attach(opened.id);
   await sandbox.shell().result;
   EOF

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   printf 'calls:\n'
   cat "$probe/calls.log"
   ```

## Observed Behavior

The archive is extracted into the launched job's actual project directory, but the attached sandbox shell starts in unrelated `/workspace`:

```text
calls:
docker run -d -i --name poe-env-... probe-image sh -c while :; do sleep 3600; done
docker cp /tmp/.../workspace.tar container-id:/tmp/poe-workspace-upload.tar
docker exec container-id sh -c mkdir -p '/tmp/poe-docker-sandbox-cwd-probe.../custom-project' && tar -xf /tmp/poe-workspace-upload.tar -C '/tmp/poe-docker-sandbox-cwd-probe.../custom-project'
docker --version
docker exec -i -t -w /workspace container-id sh
```

`packages/process-runner/src/docker/docker-execution-env.ts:124` through `packages/process-runner/src/docker/docker-execution-env.ts:164` upload into `input.spec.cwd`. `src/cli/commands/runtime/jobs/sandbox.ts:15` through `src/cli/commands/runtime/jobs/sandbox.ts:19` call `factory.attach(envId)` without a stored working-directory context. The Docker adapter therefore calls `createAttachedSpec()` with its `/workspace` default in `packages/process-runner/src/docker/docker-execution-env.ts:95` through `packages/process-runner/src/docker/docker-execution-env.ts:104` and `packages/process-runner/src/docker/docker-execution-env.ts:506` through `packages/process-runner/src/docker/docker-execution-env.ts:519`.

## Expected Behavior

Opening an interactive shell for an existing Docker runtime environment should start in the same container workspace directory where poe-code uploaded that environment's project files.

## Impact

Users entering a detached Docker sandbox can land in an empty or unrelated directory, conclude their files are missing, or execute debugging and repair commands against the wrong path.
