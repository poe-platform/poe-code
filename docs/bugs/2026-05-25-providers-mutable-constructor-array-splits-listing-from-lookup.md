# Providers mutable constructor array splits listing from lookup

## Summary

The exported `@poe-code/providers` `ProviderRegistry` retains the provider array supplied to its constructor for `list()` and `forAgent()`, but builds its identifier lookup map only once during construction. If an SDK caller mutates the original array afterward, the registry successfully lists and selects a newly appended provider while `get()` and all id-based operations still treat that same provider as unknown.

## Reproduction

Create the disposable probe `packages/providers/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry.js";
import type { AuthProvider } from "./types.js";

function provider(id: string): AuthProvider {
  return {
    id,
    label: id,
    auth: {
      kind: "api-key",
      envVar: `${id.toUpperCase()}_API_KEY`,
      storageKey: `provider:${id}`,
      prompt: { title: id }
    },
    apiShapes: [{ id: "openai-responses" }]
  };
}

describe("ProviderRegistry mutable input array", () => {
  it("lists a provider appended after construction that get cannot resolve", () => {
    const providers = [provider("first")];
    const registry = new ProviderRegistry(providers);
    const appended = provider("late");

    providers.push(appended);

    const listed = registry.list().map((entry) => entry.id);
    const compatible = registry.forAgent({ id: "codex", apiShapes: ["openai-responses"] })
      .map((entry) => entry.id);
    console.log(JSON.stringify({ listed, compatible, lookedUp: registry.get("late") }));
    expect(listed).toEqual(["first", "late"]);
    expect(compatible).toEqual(["first", "late"]);
    expect(registry.get("late")).toBeUndefined();
  });
});
```

Run the probe and delete it afterward:

```sh
npm exec -- vitest run packages/providers/src/__probe__.test.ts --reporter verbose
rm -f packages/providers/src/__probe__.test.ts
```

The test passes and prints a registry whose public views disagree:

```text
{"listed":["first","late"],"compatible":["first","late"]}
✓ packages/providers/src/__probe__.test.ts > ProviderRegistry mutable input array > lists a provider appended after construction that get cannot resolve
```

## Observed Behavior

`ProviderRegistry` assigns `this.providers = providers` directly in `packages/providers/src/registry.ts:47`, retaining the caller-owned array, while it separately fills `byId` only inside the constructor loop beginning at `packages/providers/src/registry.ts:40`. `list()` returns the live retained array at `packages/providers/src/registry.ts:53`, and `forAgent()` filters it at `packages/providers/src/registry.ts:61`, so an appended provider is exposed as configured and compatible. In contrast, `get()` reads only the stale `byId` map at `packages/providers/src/registry.ts:57`, and id-based login, logout, and credential operations also resolve through that map.

## Expected Behavior

A constructed registry should have one stable provider set across its public APIs. It should snapshot or defensively copy the supplied provider collection, or keep its lookup index synchronized with supported mutations; a provider surfaced by `list()` or `forAgent()` must also be addressable through `get()` and other registry operations.

## Impact

Long-lived SDK users that retain and update a provider array can display or select a compatible provider that cannot subsequently authenticate, log out, or resolve credentials through the same registry. Appending duplicate ids after construction can likewise bypass the constructor's duplicate-id guard in enumeration paths, yielding ambiguous provider-selection UI and inconsistent runtime behavior.
