# Config mutations constructor format name returns Object constructor instead of rejecting

## Summary

`@poe-code/config-mutations` exports `getConfigFormat()` to resolve a supported explicit format name (`json`, `toml`, or `yaml`) or infer one from a filename. Passing the unsupported explicit name `constructor` returns `Object.prototype.constructor` as though it were a `ConfigFormat`, rather than throwing the package's unsupported-format error.

## Reproduction

From the repository root, run this disposable passing probe:

```sh
cat > packages/config-mutations/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { getConfigFormat } from "./formats/index.js";

describe("config format inherited explicit name", () => {
  it("returns Object.prototype.constructor for unsupported constructor input", () => {
    const result = getConfigFormat("constructor");
    console.log(JSON.stringify({ type: typeof result, isFunction: typeof result === "function" }));
    expect(typeof result).toBe("function");
  });
});
EOF
trap 'rm -f packages/config-mutations/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/config-mutations/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"type":"function","isFunction":true}

✓ packages/config-mutations/src/__probe__.test.ts > config format inherited explicit name > returns Object.prototype.constructor for unsupported constructor input
```

## Observed Behavior

The format registry in `packages/config-mutations/src/formats/index.ts:8` through `packages/config-mutations/src/formats/index.ts:12` declares only `json`, `toml`, and `yaml`. Existing tests in `packages/config-mutations/src/config-mutations.test.ts:68` through `packages/config-mutations/src/config-mutations.test.ts:82` establish those explicit format names as the supported public surface, while tests at `packages/config-mutations/src/config-mutations.test.ts:59` through `packages/config-mutations/src/config-mutations.test.ts:64` expect unsupported inputs to throw. However, `getConfigFormat()` at `packages/config-mutations/src/formats/index.ts:24` through `packages/config-mutations/src/formats/index.ts:42` tests `pathOrFormat in formatRegistry`, so `constructor` matches the inherited built-in property and `formatRegistry["constructor"]` returns the JavaScript constructor function.

## Expected Behavior

`getConfigFormat("constructor")` should be rejected as an unsupported explicit format name, just like any other name outside `json`, `toml`, and `yaml`. Format lookup must require own registry entries and always return a valid `ConfigFormat` object on success.

## Impact

Callers supplying an invalid or user-controlled format name receive a function masquerading as a format handler. Later code that invokes `.parse()`, `.serialize()`, `.merge()`, or `.prune()` can fail with misleading internal errors instead of receiving a clear input-validation error at the public resolver boundary.
