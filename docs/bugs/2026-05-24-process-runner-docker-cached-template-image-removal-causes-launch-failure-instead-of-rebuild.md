# Docker cached template image removal causes launch failure instead of rebuild

## Summary

The Docker runtime template cache persists an image tag in local poe-code state and treats any matching cache entry as usable without checking whether the image still exists in the selected container engine. If the user prunes local images or otherwise removes the tagged image, later runtime launches attempt to start a missing image and fail instead of rebuilding the configured Docker template.

## Reproduction

1. From the repository root, run this disposable probe. It supplies a cached image entry but makes the fake Docker engine fail when asked to run that nonexistent image:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-missing-cached-image-probe.XXXXXX)
   mkdir -p "$probe/project"
   printf 'FROM scratch\n' > "$probe/project/Dockerfile"
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { dockerExecutionEnvFactory } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const specs: any[] = [];
   const runner = { exec(spec: any) {
     specs.push(spec);
     const stdout = new PassThrough(); stdout.end("");
     const stderr = new PassThrough(); stderr.end(spec.args?.includes("run") ? "image not found\n" : "");
     const failRun = spec.args?.includes("run");
     return { pid: 1, stdout, stderr, stdin: null, result: Promise.resolve({ exitCode: failRun ? 125 : 0 }), kill() {} };
   }} as any;
   const state = { templates: {
     async get() { return { hash: "any", image: "poe-code/local:missing", runtime_type: "docker", dockerfile_path: "${probe}/project/Dockerfile", built_at: "2026-05-24T00:00:00.000Z" }; },
     async put() {}, async remove() {}, async list() { return []; }
   }} as any;
   try {
     await dockerExecutionEnvFactory.open({
       cwd: "${probe}/project",
       runtime: { type: "docker", dockerfile: "Dockerfile", build_context: ".", build_args: {}, mounts: [], engine: "docker" },
       state, hostRunner: runner, env: {}, uploadIgnoreFiles: [], jobLabel: { tool: "node", argv: ["node"] }
     } as any);
   } catch (error) {
     console.log("error=" + (error as Error).message.split("\n")[0]);
   }
   console.log("commands=" + JSON.stringify(specs.map((spec) => spec.args?.[0])));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The factory uses the stale cached tag immediately, attempts only `docker run`, and fails without issuing a replacement `docker build`:

```text
error=Command failed with exit code 125: docker run -d -i --name poe-env-... poe-code/local:missing sh -c while :; do sleep 3600; done
commands=["run"]
```

`packages/process-runner/src/docker/docker-execution-env.ts:288` through `packages/process-runner/src/docker/docker-execution-env.ts:298` return a cached image string directly when a state entry exists. The environment opener then launches that tag in `packages/process-runner/src/docker/docker-execution-env.ts:53` through `packages/process-runner/src/docker/docker-execution-env.ts:93`; there is no image-presence validation or fallback rebuild between the cache hit and container startup.

## Expected Behavior

If a locally cached Docker template entry points to an image no longer present in the selected engine, poe-code should treat the cache entry as stale and rebuild the configured template, or report a cache-invalidity error with a supported recovery action.

## Impact

Routine image cleanup commands such as container-engine prune operations can leave poe-code runtime state unusable and make otherwise valid Docker-backed runs fail until the user manually discovers and bypasses or clears the stale cache.
