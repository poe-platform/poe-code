# Docker runtime reattach loses a configured Podman engine

## Summary

A Docker runtime can be opened with `engine: "podman"`, but detached job persistence records only its environment ID and local working directory. When the job is later reattached for synchronization, `dockerExecutionEnvFactory.attach()` re-detects the available engine instead of retaining the engine used to create the container. On a machine where both Docker and Podman are available, a Podman container is then addressed through Docker and synchronization fails.

## Reproduction

1. From the repository root, run this disposable probe. The fake `podman` successfully creates a container, while fake `docker` is also detectable but rejects attempts to address the Podman container:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-attach-engine-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/bin"
   printf 'LOCAL\n' > "$probe/local/file.txt"
   : > "$probe/calls.log"
   cat > "$probe/bin/podman" <<'EOF'
   #!/bin/sh
   printf 'podman %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then printf 'podman version\n'; exit 0; fi
   if [ "$1" = "run" ]; then printf 'podman-container-id\n'; exit 0; fi
   exit 0
   EOF
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then printf 'docker version\n'; exit 0; fi
   printf 'wrong engine selected for podman container\n' >&2
   exit 73
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/podman" "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const opened = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local",
     runtime: { type: "docker", image: "probe-image", engine: "podman" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   console.log("opened=" + opened.id);
   const attached = await dockerExecutionEnvFactory.attach(opened.id, {
     jobId: "job-1", tool: "node", argv: ["node"], cwd: "${probe}/local"
   });
   try {
     await attached.downloadWorkspace({ conflictPolicy: "overwrite" });
   } catch (error) {
     console.log("syncError=" + (error as Error).message.split("\n")[0]);
   }
   EOF

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   printf 'calls:\n'
   cat "$probe/calls.log"
   ```

## Observed Behavior

The initial environment is launched through Podman, but the reattached download uses Docker and fails against the Podman container ID:

```text
opened=podman-container-id
syncError=Command failed with exit code 73: docker exec podman-container-id sh -c tar -cf /tmp/poe-workspace-download.tar -C '/tmp/poe-docker-attach-engine-probe.../local' .
calls:
podman run -d -i --name poe-env-... probe-image sh -c while :; do sleep 3600; done
docker --version
docker exec podman-container-id sh -c tar -cf /tmp/poe-workspace-download.tar -C '/tmp/poe-docker-attach-engine-probe.../local' .
```

`packages/process-runner/src/docker/docker-execution-env.ts:53` through `packages/process-runner/src/docker/docker-execution-env.ts:93` honor the configured engine when opening an environment. In contrast, `packages/process-runner/src/docker/docker-execution-env.ts:95` through `packages/process-runner/src/docker/docker-execution-env.ts:104` call `detectEngine()` on attachment. That detector always prefers Docker over Podman when both are installed in `packages/process-runner/src/docker/engine.ts:4` through `packages/process-runner/src/docker/engine.ts:18`. The persisted job record contains no engine field in `packages/poe-code-config/src/state/jobs.ts:7` through `packages/poe-code-config/src/state/jobs.ts:19`.

## Expected Behavior

Reattaching a detached Docker-runtime job should continue using the same container engine that created the environment, including when that configured engine is Podman and Docker is also available locally.

## Impact

Users who deliberately run detached jobs through Podman cannot reliably attach, sync, stop, or close those jobs on systems where Docker is also installed, because follow-up operations target the wrong engine.
