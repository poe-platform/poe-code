# Runtime template registry special hash names resolve inherited properties and fail to persist

## Summary

The runtime template registry represents per-backend cache entries with ordinary JavaScript objects and retrieves entries through bracket lookup. A never-stored hash such as `toString` resolves an inherited `Object.prototype` member instead of `null`, while an entry whose hash is `__proto__` mutates the entry-map prototype during insertion and disappears when the state is serialized.

## Reproduction

From the repository root, run this disposable Vitest probe against the exported template-registry API using an in-memory filesystem:

```sh
cat > packages/poe-code-config/src/__probe__.test.ts <<'TEST'
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createTemplateRegistry, type StateFileSystem, type TemplateEntry } from "./state/templates.js";

function createMemFs(): StateFileSystem {
  return createFsFromVolume(Volume.fromJSON({}, "/")).promises as unknown as StateFileSystem;
}

function createTemplate(hash: string): TemplateEntry {
  return {
    hash,
    runtime_type: "docker",
    dockerfile_path: `/repo/${hash}/Dockerfile`,
    built_at: "2026-05-24T00:00:00.000Z",
    image: `poe-code:${hash}`
  };
}

describe("template registry special hash", () => {
  it("returns Object.prototype for a never-cached inherited hash", async () => {
    const registry = createTemplateRegistry("/home/tester", createMemFs());

    const cached = await registry.get("docker", "toString");
    console.log(JSON.stringify({ type: typeof cached, isFunction: typeof cached === "function" }));

    expect(typeof cached).toBe("function");
  });

  it("cannot round-trip a template whose hash is __proto__", async () => {
    const registry = createTemplateRegistry("/home/tester", createMemFs());
    await registry.put("docker", createTemplate("__proto__"));

    const cached = await registry.get("docker", "__proto__");
    const listed = await registry.list("docker");
    console.log(JSON.stringify({ cachedHash: (cached as TemplateEntry | null)?.hash, listed }));

    expect((cached as TemplateEntry | null)?.hash).toBeUndefined();
    expect(listed).toEqual([]);
  });
});
TEST
npx vitest run packages/poe-code-config/src/__probe__.test.ts --reporter=verbose
rm packages/poe-code-config/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"type":"function","isFunction":true}
{"listed":[]}
✓ packages/poe-code-config/src/__probe__.test.ts > template registry special hash > returns Object.prototype for a never-cached inherited hash
✓ packages/poe-code-config/src/__probe__.test.ts > template registry special hash > cannot round-trip a template whose hash is __proto__
```

## Observed Behavior

`packages/poe-code-config/src/state/templates.ts:97` through `packages/poe-code-config/src/state/templates.ts:101` create backend maps as normal `{}` objects. `get()` returns `state[backend][hash] ?? null` at `packages/poe-code-config/src/state/templates.ts:62` through `packages/poe-code-config/src/state/templates.ts:65`, so inherited names including `toString` are returned as cache entries even when no template was saved. `put()` assigns `state[backend][entry.hash] = entry` at `packages/poe-code-config/src/state/templates.ts:67` through `packages/poe-code-config/src/state/templates.ts:70`, so `__proto__` changes the cache-map prototype rather than creating a serializable own entry.

## Expected Behavior

The registry should store and retrieve all accepted hash strings strictly as cache keys. A missing hash must return `null`, and inserting a valid `TemplateEntry` must survive serialization and subsequent reads even when its hash matches an object-prototype property name.

## Impact

SDK callers of the exported state registry can receive non-`TemplateEntry` values for absent cache keys or silently lose saved entries. Any caller that uses arbitrary or externally supplied cache keys can mis-detect cache hits, consume malformed values, or fail to reuse templates after an apparently successful `put()` operation.
