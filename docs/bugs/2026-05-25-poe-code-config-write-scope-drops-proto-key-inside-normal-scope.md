# Poe code config write scope drops proto key inside normal scope

## Summary

The exported `@poe-code/poe-code-config` `writeScope()` API cannot persist an own value key named `"__proto__"` inside an otherwise normal scope. It accepts a parsed input record containing that key and resolves successfully, but its value normalization mutates the temporary scope object's prototype and serializes only sibling values.

## Reproduction

Add the following disposable test as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { writeScope } from "./store.js";

describe("generic config scope value special key", () => {
  it("silently drops an own __proto__ value inside a normal scope", async () => {
    const fs = createMockFs(undefined, "/home/test");
    const values = JSON.parse('{"__proto__":"owned","normal":"kept"}') as Record<string, unknown>;

    await writeScope(fs, "/home/test/.poe-code/config.json", "models", values);

    expect(JSON.parse(fs.getContent("~/.poe-code/config.json")!)).toEqual({
      models: { normal: "kept" }
    });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > generic config scope value special key > silently drops an own __proto__ value inside a normal scope
```

Remove the disposable probe after confirmation.

## Observed Behavior

`writeScope()` normalizes each scope value through `normalizeScopeValues()`, which builds a plain `{}` and copies supplied keys using `normalized[key] = entry`. When the input record has an own `"__proto__"` key, that assignment alters the temporary normalized object's prototype rather than adding an enumerable own value. A sibling key such as `normal` is retained, so the resulting configuration is written as `{ "models": { "normal": "kept" } }` while the accepted `"__proto__"` value vanishes.

## Expected Behavior

Scope values accepted by the generic writer should round-trip as inert persisted data or be rejected explicitly. An own input key named `"__proto__"` must not be silently omitted from a normal scope because of JavaScript prototype setter behavior.

## Impact

Consumers storing arbitrary keyed configuration records through the public writer can lose a specific user-supplied setting while all surrounding data persists normally, making the failure difficult to detect. This can corrupt extension-defined maps, model or plugin metadata, or other dynamically keyed scopes without any rejection or warning to the caller.
