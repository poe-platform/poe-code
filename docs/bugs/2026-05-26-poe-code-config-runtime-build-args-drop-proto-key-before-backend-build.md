# Poe code config runtime build args drop proto key before backend build

## Summary

The exported `@poe-code/poe-code-config` `parseRuntime()` API accepts Docker and E2B `build_args` maps, but copies their entries into an ordinary object using bracket assignment. A declared build argument named `"__proto__"` is silently dropped during parsing, so the requested argument never reaches image/template hashing or backend build execution.

## Reproduction

Create a disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRuntime } from "./runtime.js";

describe("runtime build argument special keys", () => {
  it("drops a declared __proto__ build argument during parsing", () => {
    const runtime = parseRuntime(
      JSON.parse('{"type":"docker","build_args":{"__proto__":"injected-value"}}')
    );

    expect(Object.prototype.hasOwnProperty.call(runtime.build_args, "__proto__")).toBe(false);
    expect(Object.keys(runtime.build_args)).toEqual([]);
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-code-config/src/__probe__.test.ts
```

The probe passes, confirming that a syntactically declared runtime build argument vanishes from the parsed runtime configuration:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > runtime build argument special keys > drops a declared __proto__ build argument during parsing
```

## Observed Behavior

`parseRuntime()` is publicly exported from `packages/poe-code-config/src/index.ts:23` through `packages/poe-code-config/src/index.ts:36`. During runtime parsing, `parseBuildArgs()` creates `const parsed: Record<string, string> = {}` and copies caller-controlled keys through `parsed[key] = entry` at `packages/poe-code-config/src/runtime.ts:414` through `packages/poe-code-config/src/runtime.ts:430`. When the parsed JSON map owns a `"__proto__"` field, assignment changes the temporary object's prototype rather than creating an enumerable own build-argument entry. The resulting Docker runtime has an empty `build_args` map. Docker build hashing and `--build-arg` argument generation enumerate that parsed map at `packages/process-runner/src/docker/docker-execution-env.ts:327` through `packages/process-runner/src/docker/docker-execution-env.ts:365`, while E2B template hashing similarly enumerates it at `packages/runner-e2b/src/template-build.ts:85` through `packages/runner-e2b/src/template-build.ts:108`; neither backend can observe the dropped argument.

## Expected Behavior

All explicitly supplied build argument keys should either be preserved as inert own properties and forwarded to the selected backend, or rejected with a clear validation error if unsupported. `parseRuntime()` must not silently drop a declared key because it coincides with a JavaScript prototype mutator name.

## Impact

Configuration can appear to include a required Docker/E2B build parameter while the actual image or template is generated without it. This can produce incorrect builds, reuse cache identities that omit caller-declared inputs, or make runtime startup fail in confusing ways because the configured argument is absent before any backend is invoked.
