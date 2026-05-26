# Poe code config resolved runner default mutation contaminates future uploads

## Summary

`@poe-code/poe-code-config` returns the same nested `runner` default object whenever `resolveScope(runtimeConfigScope.schema, ...)` resolves an absent runtime configuration. A consumer that appends one workspace exclusion to its own resolved config silently changes the exclusions returned to later independent callers, which are then passed into workspace upload behavior.

## Reproduction

Create a disposable probe at `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveScope } from "./resolve.js";
import { runtimeConfigScope } from "./runtime.js";

describe("poe-code-config resolved runtime default isolation", () => {
  it("shares returned workspace exclusions across independent resolutions", () => {
    const first = resolveScope(runtimeConfigScope.schema, undefined, {});
    first.runner.workspace?.exclude?.push("unexpected-ignore");

    expect(resolveScope(runtimeConfigScope.schema, undefined, {}).runner.workspace?.exclude).toContain(
      "unexpected-ignore"
    );

    first.runner.workspace?.exclude?.pop();
  });
});
```

Run the targeted probe and remove it afterward:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
rm -f packages/poe-code-config/src/__probe__.test.ts
```

The probe passes, confirming that mutating one ordinary resolved default contaminates the next resolution:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > poe-code-config resolved runtime default isolation > shares returned workspace exclusions across independent resolutions
```

## Observed Behavior

`runtimeConfigScope.schema.runner.default` is initialized once from `createDefaultRunnerScope()` at `packages/poe-code-config/src/runtime.ts:75` through `packages/poe-code-config/src/runtime.ts:100`; although `createDefaultRunnerScope()` itself creates a fresh `workspace.exclude` array at `packages/poe-code-config/src/runtime.ts:364` through `packages/poe-code-config/src/runtime.ts:373`, that one result becomes a long-lived field default. `resolveScope()` returns unresolved `field.default` values directly without cloning at `packages/poe-code-config/src/resolve.ts:9` through `packages/poe-code-config/src/resolve.ts:23`. Therefore, editing `first.runner.workspace.exclude` modifies the shared schema default, and a second independent absent-config resolution includes the unexpected exclusion. The command execution loader places that resolved list in `uploadIgnoreFiles` at `packages/agent-harness-tools/src/poe-command-execution.ts:126` through `packages/agent-harness-tools/src/poe-command-execution.ts:137` and `packages/agent-harness-tools/src/poe-command-execution.ts:67`, where Docker/E2B/workspace transfer paths consume it to omit upload content.

## Expected Behavior

Each configuration resolution should return independent nested default values. Mutating a resolved runtime object owned by one caller must not alter the defaults observed by later callers, nor add new workspace exclusions unless supplied through explicit configuration or invocation options.

## Impact

Normal caller-side modification of one resolved runtime configuration can silently suppress files from later workspace uploads in the same process. Agents or managed commands may execute without source files, configuration files, or generated assets that were never intentionally excluded, making failures dependent on the prior behavior of unrelated consumers rather than declared runtime configuration.
