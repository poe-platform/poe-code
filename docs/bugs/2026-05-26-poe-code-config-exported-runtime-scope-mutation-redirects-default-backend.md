# Poe code config exported runtime scope mutation redirects default backend

## Summary

The public `@poe-code/poe-code-config` export `runtimeConfigScope` exposes the live schema object whose field defaults are reused to resolve runtime configuration. Mutating `runtimeConfigScope.schema.type.default` from `"host"` to `"docker"` changes the backend selected by later commands whose configuration does not explicitly set a runtime type.

## Reproduction

Create a disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveScope } from "./resolve.js";
import { runtimeConfigScope } from "./runtime.js";

describe("poe-code-config exported runtime scope mutation", () => {
  it("redirects later default runtime type resolution", () => {
    const typeField = runtimeConfigScope.schema.type as { default: string };
    const originalType = typeField.default;
    typeField.default = "docker";

    try {
      expect(resolveScope(runtimeConfigScope.schema, undefined, {}).type).toBe("docker");
    } finally {
      typeField.default = originalType;
    }
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-code-config/src/__probe__.test.ts
```

The probe passes, confirming that a prior mutation of the exported runtime schema changes later absent-config runtime resolution:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > poe-code-config exported runtime scope mutation > redirects later default runtime type resolution
```

## Observed Behavior

`runtimeConfigScope` is declared with mutable nested schema fields at `packages/poe-code-config/src/runtime.ts:75` through `packages/poe-code-config/src/runtime.ts:102` and publicly re-exported at `packages/poe-code-config/src/index.ts:23` through `packages/poe-code-config/src/index.ts:36`. The public resolver reads every unresolved field's current `field.default` value at `packages/poe-code-config/src/resolve.ts:9` through `packages/poe-code-config/src/resolve.ts:23`. The command-execution configuration path applies that same exported schema when runtime state is loaded at `packages/agent-harness-tools/src/poe-command-execution.ts:126` through `packages/agent-harness-tools/src/poe-command-execution.ts:137`. After an unrelated consumer assigns `runtimeConfigScope.schema.type.default = "docker"`, an otherwise absent runtime scope resolves to Docker rather than the declared Host default.

## Expected Behavior

Public schema inspection must not mutate the runtime defaults used by subsequent commands. Exported scope definitions should be deeply immutable or internal configuration loading should operate on a protected immutable canonical schema, so commands without explicit runtime configuration continue to select the host backend.

## Impact

Any same-process consumer that reads and modifies exported configuration metadata can silently redirect later command execution into a container backend instead of the host runtime. This can introduce unexpected Docker requirements, workspace-transfer behavior, sandbox semantics, failure modes, or command execution locations without any user or project configuration requesting the change.
