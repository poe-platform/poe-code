# Docker detached job log stream swallows container command failures

## Summary

The Docker detached-job `stream()` implementation reads log output by running an engine `exec` command in the container. It waits for that command to finish but never checks its exit code or stderr. If the container is unavailable or the log command fails, callers receive an empty completed log stream rather than an error indicating that logs could not be read.

## Reproduction

1. From the repository root, run this disposable probe with a fake Docker executable that is detectable during attachment but fails every container command:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-log-failure-probe.XXXXXX)
   mkdir -p "$probe/bin"
   cat > "$probe/bin/docker" <<'EOF'
   #!/bin/sh
   if [ "$1" = "--version" ]; then exit 0; fi
   printf 'container disappeared\n' >&2
   exit 75
   EOF
   cat > "$probe/bin/colima" <<'EOF'
   #!/bin/sh
   exit 1
   EOF
   chmod +x "$probe/bin/docker" "$probe/bin/colima"
   cat > "$probe/repro.mts" <<EOF
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const env = await dockerExecutionEnvFactory.attach("missing-container", {
     jobId: "job-logs", tool: "node", argv: ["node"], cwd: "/tmp/work"
   });
   let chunks = 0;
   for await (const chunk of env.job!.stream()) {
     chunks += 1;
     console.log(chunk.data);
   }
   console.log("chunks=" + chunks);
   EOF

   PATH="$probe/bin:$PATH" "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The failing Docker command is silently treated as a successful empty log stream:

```text
chunks=0
```

`packages/process-runner/src/docker/docker-execution-env.ts:460` through `packages/process-runner/src/docker/docker-execution-env.ts:478` execute the container log-tail command, read stdout, and await `handle.result`, but discard both the command result and stderr. User-facing `runtime jobs logs` consumes this stream through `src/cli/commands/runtime/jobs/logs.ts:27` through `src/cli/commands/runtime/jobs/logs.ts:38` without another opportunity to detect that log retrieval failed.

## Expected Behavior

When Docker cannot execute the detached-job log reader, the log stream or CLI command should fail with the underlying runtime error rather than report indistinguishable empty output.

## Impact

Users troubleshooting detached Docker jobs can be told nothing happened when logs are actually unavailable because the container disappeared, the engine cannot reach it, or the log-read command failed.
