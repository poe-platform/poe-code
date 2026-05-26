# Poe code config empty Docker mount source exposes process working directory

## Summary

The exported `@poe-code/poe-code-config` `parseRuntime()` API accepts a Docker mount whose `source` is the empty string. When that parsed runtime reaches Docker argument construction, `path.resolve("")` converts the blank value into the current host working directory and mounts it into the container, exposing a host directory the configuration never named.

## Reproduction

Create a disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDockerRunArgs } from "../../process-runner/src/docker/args.js";
import { parseRuntime } from "./runtime.js";

describe("runtime mount empty source validation", () => {
  it("turns an empty configured mount source into the host working directory", () => {
    const runtime = parseRuntime({
      type: "docker",
      image: "node:22",
      mounts: [{ source: "", target: "/workspace" }]
    });
    const args = buildDockerRunArgs({
      engine: "docker",
      image: "node:22",
      command: "true",
      args: [],
      containerName: "probe",
      detached: false,
      interactive: false,
      tty: false,
      rm: true,
      mounts: runtime.mounts,
      ports: [],
      extraArgs: []
    });

    expect(args).toContain(`${path.resolve("")}:/workspace`);
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-code-config/src/__probe__.test.ts
```

The probe passes, confirming that the accepted blank mount source becomes an actual Docker bind mount of the host process directory:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > runtime mount empty source validation > turns an empty configured mount source into the host working directory
```

## Observed Behavior

`parseRuntime()` is publicly exported at `packages/poe-code-config/src/index.ts:23` through `packages/poe-code-config/src/index.ts:36`. Its `parseMounts()` helper validates only that `source` and `target` are strings at `packages/poe-code-config/src/runtime.ts:433` through `packages/poe-code-config/src/runtime.ts:460`, so `source: ""` is accepted unchanged. The Docker runner's argument builder then constructs each volume using `path.resolve(mount.source)` at `packages/process-runner/src/docker/args.ts:39` through `packages/process-runner/src/docker/args.ts:42`. In Node, resolving the empty path yields the process current working directory, producing a Docker argument such as `-v /repo:/workspace` even though the configured source was blank.

## Expected Behavior

Runtime mount configuration should reject empty or whitespace-only source paths before backend execution, or require an explicit resolved path. An omitted/blank source must never implicitly authorize mounting the process working directory into a container.

## Impact

A malformed, environment-substituted, or unintentionally blank Docker mount configuration can expose the entire host working directory inside a runtime container. Commands expected to run with limited mounted content may receive repository files, secrets, build outputs, or other local state without an explicit mount path in configuration, weakening isolation and making execution dependent on where the process happened to start.
