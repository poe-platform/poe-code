# Config extends nonobject structured documents silently become empty config

## Summary

The exported `@poe-code/config-extends` parser accepts syntactically valid YAML or JSON documents whose root value is not an object, then silently converts them into an empty configuration object. A scalar YAML document or array JSON document is therefore reported as successfully parsed configuration with all supplied content discarded instead of producing an invalid-config error.

## Reproduction

From the repository root, run a disposable Vitest probe that parses a scalar YAML document and an array JSON document:

```sh
cat > packages/config-extends/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse.js";

describe("structured non-object document repro", () => {
  it("silently accepts scalar and array config roots as empty data", () => {
    const yamlScalar = parseDocument("not-a-config", "/repo/config.yaml");
    const jsonArray = parseDocument('[{"prompt":"lost"}]', "/repo/config.json");

    console.log(JSON.stringify({ yamlScalar, jsonArray }));
    expect(yamlScalar).toEqual({ data: {}, format: "yaml", extends: false, hasExtendsField: false });
    expect(jsonArray).toEqual({ data: {}, format: "json", extends: false, hasExtendsField: false });
  });
});
EOF
npm exec -- vitest run packages/config-extends/src/__probe__.test.ts --reporter verbose
rm -f packages/config-extends/src/__probe__.test.ts
nl -ba packages/config-extends/src/parse.ts | sed -n '1,75p'
```

## Observed Behavior

Both malformed configuration shapes parse without error, returning empty `data` objects and no indication that supplied values were discarded:

```text
{"yamlScalar":{"data":{},"format":"yaml","extends":false,"hasExtendsField":false},"jsonArray":{"data":{},"format":"json","extends":false,"hasExtendsField":false}}
✓ packages/config-extends/src/__probe__.test.ts > structured non-object document repro > silently accepts scalar and array config roots as empty data
```

`parseDocument()` parses YAML and JSON content and forwards the result into `toData(...)` in `packages/config-extends/src/parse.ts:5` through `packages/config-extends/src/parse.ts:20`. `toData(...)` returns `{}` for falsy values, primitives, or arrays at `packages/config-extends/src/parse.ts:59` through `packages/config-extends/src/parse.ts:65` rather than rejecting them as invalid root shapes. The parser then returns that empty object as a successful parsed document.

## Expected Behavior

Structured config documents should require an object/map root. Syntactically valid YAML or JSON whose top-level value is a scalar, array, or null should reject with a clear invalid configuration error rather than silently becoming an empty configuration.

## Impact

A mistyped or generated base/document configuration can be accepted while silently dropping its complete contents. Resolution proceeds with missing prompts, metadata, or extension settings, making configuration failures difficult to diagnose and potentially causing workflows to run with unintended fallback behavior.
