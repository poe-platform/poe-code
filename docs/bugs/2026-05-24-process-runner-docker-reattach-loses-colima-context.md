# Docker runtime reattach loses the Colima context that created its container

## Summary

When a Docker runtime is opened while a Colima Docker context is detected, its container is created with `docker --context colima`. Detached job persistence does not store that context. When the job is later reattached, `dockerExecutionEnvFactory.attach()` detects context again and can issue commands without the original `--context`, making the detached container unreachable if Colima is no longer detected in the later process.

## Reproduction

1. From the repository root, run this disposable probe. During environment creation, fake `colima` reports a running Docker profile; before attachment it stops reporting that profile, and fake `docker` permits the container only through the original context:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-attach-context-probe.XXXXXX)
   mkdir -p "$probe/local" "$probe/bin"
   printf 'LOCAL\n' > "$probe/local/file.txt"
   printf 'running\n' > "$probe/context-state"
   : > "$probe/calls.log"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   printf 'docker %s\n' "$*" >> "$CALLS_LOG"
   if [ "$1" = "--version" ]; then printf 'docker version\n'; exit 0; fi
   if [ "$1" = "--context" ] && [ "$2" = "colima" ] && [ "$3" = "run" ]; then printf 'colima-container-id\n'; exit 0; fi
   printf 'container is only reachable through colima context\n' >&2
   exit 74
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   if [ "$1" = "list" ] && [ "$2" = "--json" ] && [ "$(cat "$CONTEXT_STATE")" = "running" ]; then
     printf '{"name":"default","status":"Running","runtime":"docker"}\n'
   fi
   exit 0
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { writeFile } from "node:fs/promises";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const opened = await dockerExecutionEnvFactory.open({
     cwd: "${probe}/local",
     runtime: { type: "docker", image: "probe-image", engine: "docker" },
     runner: { sync: "both" }, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
   } as any);
   console.log("opened=" + opened.id);
   await writeFile("${probe}/context-state", "stopped\n");
   const attached = await dockerExecutionEnvFactory.attach(opened.id, {
     jobId: "job-1", tool: "node", argv: ["node"], cwd: "${probe}/local"
   });
   try {
     await attached.downloadWorkspace({ conflictPolicy: "overwrite" });
   } catch (error) {
     console.log("syncError=" + (error as Error).message.split("\n")[0]);
   }
   EOF

   PATH="$probe/bin:$PATH" CALLS_LOG="$probe/calls.log" CONTEXT_STATE="$probe/context-state" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   printf 'calls:\n'
   cat "$probe/calls.log"
   ```

## Observed Behavior

The container is created through Colima, but reattached synchronization omits `--context colima` and fails to reach it:

```text
opened=colima-container-id
syncError=Command failed with exit code 74: docker exec colima-container-id sh -c tar -cf /tmp/poe-workspace-download.tar -C '/tmp/poe-docker-attach-context-probe.../local' .
calls:
docker --context colima run -d -i --name poe-env-... probe-image sh -c while :; do sleep 3600; done
docker --version
docker exec colima-container-id sh -c tar -cf /tmp/poe-workspace-download.tar -C '/tmp/poe-docker-attach-context-probe.../local' .
```

`packages/process-runner/src/docker/docker-execution-env.ts:53` through `packages/process-runner/src/docker/docker-execution-env.ts:93` determine and preserve the Docker context only for the initially opened environment. `packages/process-runner/src/docker/docker-execution-env.ts:95` through `packages/process-runner/src/docker/docker-execution-env.ts:104` run `detectContext()` again during attachment. The context detector depends on currently reported Colima profiles in `packages/process-runner/src/docker/context.ts:11` through `packages/process-runner/src/docker/context.ts:37`, while the persisted job record contains no context field in `packages/poe-code-config/src/state/jobs.ts:7` through `packages/poe-code-config/src/state/jobs.ts:19`.

## Expected Behavior

Reattaching a detached Docker-runtime job should keep using the Docker context that created its container, even if later Colima detection no longer reports the same profile.

## Impact

Detached jobs created in a Colima context can become impossible to attach, synchronize, stop, or close after a later invocation loses or changes context detection, despite the container still existing in its original context.
