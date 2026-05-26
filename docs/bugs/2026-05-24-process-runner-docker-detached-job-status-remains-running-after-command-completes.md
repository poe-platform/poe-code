# Docker detached job status remains running after the command completes

## Summary

Docker execution environments keep a sandbox container alive by launching an infinite sleep loop, then run the actual detached command inside that container with `docker exec`. The Docker `JobHandle.status()` implementation inspects only the sandbox container state. Because the keeper remains running after the detached command has written its exit marker and completed, completed Docker jobs continue to report `running` indefinitely until the container itself is stopped.

## Reproduction

1. From the repository root, run this disposable probe with a capturing Docker runner. The sandbox container remains running while the simulated detached command has already completed and written an exit marker:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-detached-status-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";

   void (async () => {
     const commands: string[] = [];
     const runner = {
       name: "probe",
       exec(spec: any) {
         commands.push([spec.command, ...(spec.args ?? [])].join(" "));
         const stdout = new PassThrough();
         const isRun = spec.args?.includes("run");
         const isInspect = spec.args?.includes("inspect");
         stdout.end(isRun ? "container-live\\n" : isInspect ? "running\\n" : "");
         return { pid: null, stdin: null, stdout, stderr: new PassThrough(), result: Promise.resolve({ exitCode: 0 }), kill() {} };
       }
     } as any;
     const env = await dockerExecutionEnvFactory.open({
       cwd: "/repo", runtime: { type: "docker", image: "base", engine: "docker" }, hostRunner: runner,
       env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }
     } as any);
     const execution = env.exec({ command: "sh", args: ["-c", "echo 7 > /tmp/poe-jobs/job.exit"], stdin: "ignore", stdout: "pipe", stderr: "pipe" });
     await execution.result;
     const job = await env.detach();
     console.log(JSON.stringify({ status: await job.status(), commands }));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

After the simulated detached command completes, the job status is still reported as running solely because the sandbox container's keeper loop remains alive:

```text
{"status":"running","commands":["docker run -d -i --name poe-env-... base sh -c while :; do sleep 3600; done","docker exec container-live sh -c echo 7 > /tmp/poe-jobs/job.exit","docker inspect -f {{.State.Status}} container-live"]}
```

Docker opens its environment by running the persistent keeper command `while :; do sleep 3600; done` in `packages/process-runner/src/docker/docker-execution-env.ts:48` through `packages/process-runner/src/docker/docker-execution-env.ts:93`. Actual work is launched later with `docker exec` in `packages/process-runner/src/docker/docker-execution-env.ts:204` through `packages/process-runner/src/docker/docker-execution-env.ts:228`; detached wrapped commands write per-job exit files through `packages/agent-harness-tools/src/log-stream.ts:20` through `packages/agent-harness-tools/src/log-stream.ts:34`. However, `createContainerJob(...).status()` inspects only `{{.State.Status}}` of the keeper container in `packages/process-runner/src/docker/docker-execution-env.ts:428` through `packages/process-runner/src/docker/docker-execution-env.ts:459` and never reads the detached job's exit marker.

## Expected Behavior

Docker detached-job status should reflect completion of the detached command identified by the job record, using its exit marker or command lifecycle, while allowing the reusable sandbox container to remain available for sync and debugging.

## Impact

Naturally completed Docker detached jobs never become `exited` in listings or attachment flows while their sandbox remains alive. Users cannot reliably know when work has finished, `attach --sync-on-exit` does not trigger naturally, and jobs appear perpetually active until explicitly killed.
