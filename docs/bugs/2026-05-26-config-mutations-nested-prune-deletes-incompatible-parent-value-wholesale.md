# Config mutations nested prune deletes incompatible parent value wholesale

## Summary

The exported `@poe-code/config-mutations` format pruning API accepts nested removal shapes intended to delete specific child keys from configuration objects. When the persisted parent value is instead an incompatible value such as an array, `jsonFormat.prune()` silently deletes that entire parent value rather than rejecting the shape mismatch or leaving the unrelated data intact.

## Reproduction

Create the following disposable probe at `packages/config-mutations/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jsonFormat } from "./formats/json.js";

describe("nested prune against incompatible data", () => {
  it("deletes an array value when asked only to prune a nested child key", () => {
    expect(
      jsonFormat.prune(
        { mcpServers: ["poe-code", "user-server"] },
        { mcpServers: { "poe-code": {} } }
      )
    ).toEqual({ changed: true, result: {} });
  });
});
```

Run the probe and remove it immediately afterward:

```sh
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
rm packages/config-mutations/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/config-mutations/src/__probe__.test.ts > nested prune against incompatible data > deletes an array value when asked only to prune a nested child key
```

## Observed Behavior

The prune request names only nested child `mcpServers["poe-code"]`, but the operation returns `{ changed: true, result: {} }`, erasing the complete existing array value including the unrelated `"user-server"` entry. In `packages/config-mutations/src/formats/json.ts:72`, nested recursion occurs only when both the pattern and current value are configuration objects. When the nested pattern is an object but the current parent is an array, execution falls through to unconditional `delete result[key]` at `packages/config-mutations/src/formats/json.ts:96`. The TOML and YAML format implementations contain the same fall-through deletion behavior at `packages/config-mutations/src/formats/toml.ts:79` and `packages/config-mutations/src/formats/yaml.ts:77`.

## Expected Behavior

A nested prune shape should remove only named nested members from a compatible object/table value. When persisted configuration has an incompatible parent type, the operation should reject the shape mismatch or report a no-op; it must not interpret a request to delete one child key as authorization to delete the whole unrelated parent value.

## Impact

Any consumer using declarative nested pruning to remove owned configuration fragments can erase unrelated user content when an existing file contains a migrated, malformed, or externally managed value of another type. This can turn safe cleanup or unconfiguration operations into silent configuration data loss across JSON, TOML, and YAML-backed integrations.
