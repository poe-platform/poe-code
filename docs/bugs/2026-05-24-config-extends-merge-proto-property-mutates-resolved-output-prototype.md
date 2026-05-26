# Config extends merge proto property mutates resolved output prototype

## Summary

The exported `mergeLayers()` utility in `@poe-code/config-extends` copies configuration keys into normal JavaScript objects. When parsed configuration data contains an own `__proto__` property with an object value, merging reports success but mutates the returned data object's prototype rather than retaining the configuration property as ordinary data.

## Reproduction

From the repository root, run a disposable Vitest probe that merges one JSON-derived configuration layer containing an explicit `__proto__` key:

```sh
cat > /tmp/config-extends-proto-merge-probe.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { mergeLayers } from "./merge.js";

describe("config-extends merge __proto__", () => {
  it("mutates the merged output prototype from a parsed __proto__ property", () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;
    const result = mergeLayers([{ source: "document", data: malicious }]);
    console.log(JSON.stringify({ ownsProto: Object.hasOwn(result.data, "__proto__"), polluted: (result.data as { polluted?: string }).polluted }));
    expect(Object.hasOwn(result.data, "__proto__")).toBe(false);
    expect((result.data as { polluted?: string }).polluted).toBe("yes");
  });
});
PROBE
cp /tmp/config-extends-proto-merge-probe.test.ts packages/config-extends/src/__probe__.test.ts
trap 'rm -f packages/config-extends/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The merged result no longer owns the `__proto__` data key, but attacker-provided content appears through its prototype:

```text
{"ownsProto":false,"polluted":"yes"}
✓ packages/config-extends/src/__probe__.test.ts > config-extends merge __proto__ > mutates the merged output prototype from a parsed __proto__ property
```

`packages/config-extends/src/merge.ts:12` through `packages/config-extends/src/merge.ts:27` create the output as a plain `{}` and assign each collected configuration key through `data[key] = resolved.value`. A key named `__proto__` therefore triggers the inherited setter on the output object instead of creating an own merged property.

## Expected Behavior

Merging parsed configuration layers should preserve explicit own keys, including `__proto__`, as ordinary data without changing the prototype of the resolved result. The implementation should use a prototype-safe output representation or property definition strategy.

## Impact

Untrusted or user-edited configuration can produce prototype-mutated resolved data while appearing to merge normally. Downstream consumers may observe inherited attacker-controlled properties, lose the original configuration entry, or make decisions using polluted resolved configuration state.
