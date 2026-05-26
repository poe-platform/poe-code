# Docker runtime template cache ignores build-context file changes

## Summary

The Docker runtime template cache hash includes the Dockerfile bytes and build arguments, but not files in the configured build context. A Dockerfile that uses `COPY` or `ADD` can therefore reuse a cached image after its source files change, causing execution to run against obsolete image contents unless the user knows to force a rebuild.

## Reproduction

1. From the repository root, run this disposable probe. It builds a Docker template from a `COPY app.txt` Dockerfile, updates `app.txt`, and builds again using an in-memory template cache and a capturing runner:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-context-cache-probe.XXXXXX)
   mkdir -p "$probe/project/context"
   printf 'FROM scratch\nCOPY app.txt /app.txt\n' > "$probe/project/Dockerfile"
   printf 'VERSION ONE\n' > "$probe/project/context/app.txt"
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { writeFile } from "node:fs/promises";
   import { buildDockerRuntimeTemplate } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const cache = new Map<string, any>();
   const specs: any[] = [];
   const runner = {
     exec(spec: any) {
       specs.push(spec);
       const stdout = new PassThrough(); stdout.end("");
       const stderr = new PassThrough(); stderr.end("");
       return { pid: 1, stdout, stderr, stdin: null, result: Promise.resolve({ exitCode: 0 }), kill() {} };
     }
   } as any;
   const state = { templates: {
     async get(_backend: string, hash: string) { return cache.get(hash) ?? null; },
     async put(_backend: string, entry: any) { cache.set(entry.hash, entry); },
     async remove() {}, async list() { return []; }
   }} as any;
   const runtime = { type: "docker", dockerfile: "Dockerfile", build_context: "context", build_args: {}, mounts: [], engine: "docker" } as any;
   const first = await buildDockerRuntimeTemplate({ cwd: "${probe}/project", runtime, state, runner });
   await writeFile("${probe}/project/context/app.txt", "VERSION TWO\n");
   const second = await buildDockerRuntimeTemplate({ cwd: "${probe}/project", runtime, state, runner });
   console.log("first=" + JSON.stringify(first));
   console.log("second=" + JSON.stringify(second));
   console.log("buildCalls=" + specs.filter((spec) => spec.args?.includes("build")).length);
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The changed build-context file does not affect the template hash, and the second build reports a cache hit without invoking Docker build again:

```text
first={"backend":"docker","hash":"5045b6be78d9cc17c9eb223b8fc8fee83b0bf732a31bfb1c7421e7fa5fcee89d","image":"poe-code/local:5045b6be78d9cc17c9eb223b8fc8fee83b0bf732a31bfb1c7421e7fa5fcee89d","cached":false}
second={"backend":"docker","hash":"5045b6be78d9cc17c9eb223b8fc8fee83b0bf732a31bfb1c7421e7fa5fcee89d","image":"poe-code/local:5045b6be78d9cc17c9eb223b8fc8fee83b0bf732a31bfb1c7421e7fa5fcee89d","cached":true}
buildCalls=1
```

`packages/process-runner/src/docker/docker-execution-env.ts:283` through `packages/process-runner/src/docker/docker-execution-env.ts:290` calculate the cached image identity, while `packages/process-runner/src/docker/docker-execution-env.ts:327` through `packages/process-runner/src/docker/docker-execution-env.ts:337` hash only Dockerfile bytes and sorted build arguments. The same builder passes `buildContext` to the actual engine build command in `packages/process-runner/src/docker/docker-execution-env.ts:340` through `packages/process-runner/src/docker/docker-execution-env.ts:366`, so those omitted files can affect the image output.

## Expected Behavior

The Docker template cache key should change whenever input files that can affect the configured Docker build context change, matching the deterministic context-sensitive hashing behavior used for E2B templates.

## Impact

Users can edit application files, configuration, or dependencies copied into a Docker runtime image and then unknowingly execute agents in an old cached image that does not include their updates.
