# Docker runtime template cache reuses a Docker-engine image for Podman execution

## Summary

The Docker runtime supports explicitly selecting either the Docker or Podman engine, but its persisted template cache identity excludes the selected engine. If a template is first built through Docker and then the same runtime inputs are requested through Podman, the Podman run reuses the Docker cache entry without performing a Podman build, even though each engine maintains its own local image store.

## Reproduction

1. From the repository root, run this disposable probe. It builds once with `engine: "docker"`, then requests the same template with `engine: "podman"` using an in-memory template cache and a capturing runner:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-docker-engine-cache-probe.XXXXXX)
   mkdir -p "$probe/project"
   printf 'FROM scratch\n' > "$probe/project/Dockerfile"
   cat > "$probe/repro.mts" <<EOF
   import { PassThrough } from "node:stream";
   import { buildDockerRuntimeTemplate } from "${workspace}/packages/process-runner/src/docker/docker-execution-env.ts";
   const cache = new Map<string, any>();
   const specs: any[] = [];
   const runner = { exec(spec: any) {
     specs.push(spec);
     const stdout = new PassThrough(); stdout.end("");
     const stderr = new PassThrough(); stderr.end("");
     return { pid: 1, stdout, stderr, stdin: null, result: Promise.resolve({ exitCode: 0 }), kill() {} };
   }} as any;
   const state = { templates: {
     async get(_backend: string, hash: string) { return cache.get(hash) ?? null; },
     async put(_backend: string, entry: any) { cache.set(entry.hash, entry); },
     async remove() {}, async list() { return []; }
   }} as any;
   const base = { type: "docker", dockerfile: "Dockerfile", build_context: ".", build_args: {}, mounts: [] } as any;
   const first = await buildDockerRuntimeTemplate({ cwd: "${probe}/project", runtime: { ...base, engine: "docker" }, state, runner });
   const second = await buildDockerRuntimeTemplate({ cwd: "${probe}/project", runtime: { ...base, engine: "podman" }, state, runner });
   console.log(JSON.stringify({ sameHash: first.hash === second.hash, secondCached: second.cached, commands: specs.map((spec) => spec.command) }));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   ```

## Observed Behavior

The Podman request resolves to the Docker-built cache entry and no Podman build command is issued:

```text
{"sameHash":true,"secondCached":true,"commands":["docker"]}
```

`packages/process-runner/src/docker/docker-execution-env.ts:280` through `packages/process-runner/src/docker/docker-execution-env.ts:282` select the engine used for building, and `packages/process-runner/src/docker/docker-execution-env.ts:340` through `packages/process-runner/src/docker/docker-execution-env.ts:366` execute the build through that engine. However, `packages/process-runner/src/docker/docker-execution-env.ts:327` through `packages/process-runner/src/docker/docker-execution-env.ts:337` compute the cache key without `runtime.engine`.

## Expected Behavior

Docker-runtime template cache entries should be scoped to the selected container engine, or otherwise verify the cached image exists in the engine that will execute it before reusing the entry.

## Impact

Users switching a runtime from Docker to Podman can receive a cache hit for an image that exists only in Docker's store, causing later container startup to fail or execute an unintended image with the same tag in Podman.
