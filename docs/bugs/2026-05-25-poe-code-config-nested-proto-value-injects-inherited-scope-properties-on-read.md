# Poe code config nested proto value injects inherited scope properties on read

## Summary

`@poe-code/poe-code-config` normalizes values within each stored configuration scope into ordinary JavaScript objects using bracket assignment. A persisted nested key named `"__proto__"` can therefore replace the prototype of an otherwise retained scope and expose attacker-supplied inherited properties as if they were normal configuration values.

## Reproduction

Add the following disposable test as `packages/poe-code-config/src/__probe__.test.ts`:

```ts
import { createMockFs } from "@poe-code/config-mutations/testing";
import { describe, expect, it } from "vitest";
import { readDocument } from "./store.js";

describe("nested config scope proto read", () => {
  it("returns inherited values injected alongside a retained scope value", async () => {
    const fs = createMockFs(
      { "~/.poe-code/config.json": '{"models":{"__proto__":{"injected":"model"},"normal":"kept"}}' },
      "/home/test"
    );

    const document = await readDocument(fs, "/home/test/.poe-code/config.json");
    expect(document.models!.normal).toBe("kept");
    expect(Object.hasOwn(document.models!, "injected")).toBe(false);
    expect(document.models!.injected).toBe("model");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-code-config/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/poe-code-config/src/__probe__.test.ts > nested config scope proto read > returns inherited values injected alongside a retained scope value
```

Remove the disposable probe after confirmation.

## Observed Behavior

`readDocument()` calls `normalizeScopeValues()` for each parsed top-level scope. That helper creates a plain `{}` and copies every nested key with `normalized[key] = entry`. For the stored `models.__proto__` key, assignment alters the returned `models` object's prototype. Because the scope also contains the ordinary `normal` field, the scope survives normalization and callers can subsequently read `document.models.injected === "model"` even though `injected` is not an own configured value.

## Expected Behavior

Nested persisted configuration keys should be preserved as own data properties or rejected before exposure. Reading a normal stored scope that includes `"__proto__"` must not mutate the returned scope prototype or synthesize inherited settings absent from its own stored fields.

## Impact

A crafted or corrupted config file can inject inherited properties into ordinary configuration scopes consumed by SDK and CLI features. Dynamic lookups can observe attacker-controlled values that are absent from explicit configuration entries, undermining configuration integrity and making audit output differ from runtime behavior.
