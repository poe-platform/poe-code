# Poe code config write scope proto name silently drops written scope

## Summary

The exported `@poe-code/poe-code-config` `writeScope()` API accepts arbitrary scope names, but it cannot persist a scope named `"__proto__"`. The operation resolves successfully while assigning the supplied values onto the document object's prototype instead of creating a stored top-level scope, so immediate reads return no written configuration.

## Reproduction

Add the following disposable test as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { readDocument, writeScope } from "./store.js";

describe("generic config scope special write name", () => {
  it("acknowledges but cannot round-trip a written __proto__ scope", async () => {
    const fs = createMockFs(undefined, "/home/test");

    await writeScope(fs, "/home/test/.poe-code/config.json", "__proto__", {
      mode: "owned"
    });

    await expect(readDocument(fs, "/home/test/.poe-code/config.json")).resolves.toEqual({});
    expect(JSON.parse(fs.getContent("~/.poe-code/config.json")!)).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > generic config scope special write name > acknowledges but cannot round-trip a written __proto__ scope
```

Remove the disposable probe after confirmation.

## Observed Behavior

`writeScope()` reads or creates a normal configuration document object, normalizes supplied values, and assigns nonempty data using `document[scope] = normalizedValues`. With `scope === "__proto__"`, that assignment changes the prototype of the temporary object rather than creating an own serialized property. `writeDocument()` therefore persists `{}`, and `readDocument()` cannot retrieve the scope that `writeScope()` accepted. This is the write-side failure complementary to the previously documented read-side inherited scope injection from stored JSON.

## Expected Behavior

The generic scope writer should persist and round-trip every accepted scope name as inert configuration data, or explicitly reject unsafe names before resolving. Writing a scope named `"__proto__"` must not succeed while silently omitting the caller's values.

## Impact

Any package or SDK consumer using the exported generic configuration writer with dynamically defined scope names can receive a successful completion while its configuration is discarded. This makes configuration persistence unreliable for valid string inputs and can leave users or automation believing settings were stored when no state survives on disk.
