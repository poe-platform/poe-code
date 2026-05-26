# Config extends dotted key collides with nested source provenance

## Summary

The exported `@poe-code/config-extends` `mergeLayers()` API accepts both literal configuration keys that contain dots and nested configuration objects, but it serializes source provenance for both shapes into the same dot-delimited key. A literal `"service.url"` value and a nested `service.url` value can coexist in the resolved data while only one of their source attributions survives in `sources`.

## Reproduction

Create a disposable Vitest probe at `packages/config-extends/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { mergeLayers } from "./merge.js";

describe("merge source provenance for dotted configuration keys", () => {
  it("preserves attribution for a literal dotted key alongside a nested key", () => {
    const merged = mergeLayers([
      { source: "literal", data: { "service.url": "literal-value" } },
      { source: "nested", data: { service: { url: "nested-value" } } },
    ]);

    console.log(JSON.stringify(merged));
    expect(merged.data).toEqual({
      "service.url": "literal-value",
      service: { url: "nested-value" },
    });
    expect(merged.sources["service.url"]).toBe("literal");
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
rm -f packages/config-extends/src/__probe__.test.ts
```

The probe retains both distinct data values but fails because the nested value overwrites the literal dotted key's provenance entry:

```text
{"data":{"service.url":"literal-value","service":{"url":"nested-value"}},"sources":{"service.url":"nested","service":"nested"}}
AssertionError: expected 'nested' to be 'literal'
```

## Observed Behavior

`mergeLayers()` successfully returns distinct resolved data for the literal key `"service.url"` and the nested path `service.url`, but returns only `sources["service.url"] = "nested"`, losing the fact that the literal key came from `"literal"`. In `packages/config-extends/src/merge.ts`, `buildPath()` joins path segments with `"."`, so both key shapes map to the identical provenance string and the later assignment replaces the earlier one.

## Expected Behavior

Source provenance should remain unambiguous for every resolved configuration value that the data model accepts. Literal keys containing dots and nested object paths should either use an escaped/structured provenance representation or reject ambiguous keys clearly, rather than silently attributing one resolved value to the source of a different value.

## Impact

Callers that display configuration origins, diagnose overrides, or audit loaded agent settings can report the wrong source document for literal dotted keys whenever a nested path shares the same serialized name. The final data still contains both values, so this silent attribution corruption is difficult to detect without explicitly inspecting provenance collisions.
