# Docker detached job wait blocks on the sandbox container after the command completes

## Summary

Docker detached execution runs the actual job inside a long-lived sandbox container. The Docker `JobHandle.wait()` implementation runs `docker wait` on that sandbox container rather than waiting for the detached command's exit marker. A detached command can therefore finish while `job.wait()` remains pending indefinitely because the intentionally persistent container is still running.

## Reproduction

1. From the repository root, run this disposable probe with a Docker environment whose sandbox is created successfully and whose `docker wait` operation stays pending like a live keeper container:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-detached-wait-hang-probe.XXXXXX)
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";

   void (async () => {
     let waitRequested = false;
     const runner = {
       name: "probe",
       exec(spec: any) {
         const stdout = new PassThrough();
         const isRun = spec.args?.includes("run");
         const isWait = spec.args?.includes("wait");
         if (isWait) {
           waitRequested = true;
           return { pid: null, stdin: null, stdout, stderr: new PassThrough(), result: new Promise(() => {}), kill() {} };
         }
         stdout.end(isRun ? "container-live\\n" : "");
         return { pid: null, stdin: null, stdout, stderr: new PassThrough(), result: Promise.resolve({ exitCode: 0 }), kill() {} };
       }
     } as any;
     const env = await dockerExecutionEnvFactory.open({
       cwd: "/repo", runtime: { type: "docker", image: "base", engine: "docker" }, hostRunner: runner,
       env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "agent", argv: ["agent"] }
     } as any);
     const job = await env.detach();
     let settled = false;
     void job.wait().then(() => { settled = true; });
     await new Promise((resolve) => setTimeout(resolve, 20));
     console.log(JSON.stringify({ waitRequested, settled }));
   })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

`job.wait()` issues a container wait request and remains pending while the keeper container stays alive:

```text
{"waitRequested":true,"settled":false}
```

Docker creates the runtime environment as a persistent `while :; do sleep 3600; done` container in `packages/process-runner/src/docker/docker-execution-env.ts:48` through `packages/process-runner/src/docker/docker-execution-env.ts:93`, while actual detached commands execute separately inside it. Nevertheless, `createContainerJob(...).wait()` calls `docker wait <containerId>` and derives its result from the keeper container in `packages/process-runner/src/docker/docker-execution-env.ts:480` through `packages/process-runner/src/docker/docker-execution-env.ts:490`. The shared detached-job contract exposes `wait()` as waiting for the job result in `packages/agent-harness-tools/src/execution-env.ts:79` through `packages/agent-harness-tools/src/execution-env.ts:88`.

## Expected Behavior

`JobHandle.wait()` for a Docker detached job should settle when the detached command completes, using the per-job completion marker or equivalent command tracking, without requiring the reusable sandbox container to be stopped.

## Impact

Any workflow waiting for a naturally completed Docker detached job can block indefinitely while its sandbox is retained for debugging or workspace synchronization. Completion handling, synchronization-on-exit, and automation cannot reliably progress without forcibly stopping the container.
