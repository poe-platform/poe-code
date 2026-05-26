# Agent Hook Config Writer Null Event Groups Throws Native Filter Error

## Summary

The exported `writeCodexHooks()` function accepts an existing Codex hooks file containing syntactically valid JSON, but assumes every value under `hooks` is an array. If an event value is `null`, writing hooks fails with the incidental runtime error `groups.filter is not a function` instead of a controlled invalid-configuration diagnostic.

## Reproduction

Create the disposable probe `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { writeCodexHooks } = await import("./write-hooks.js");

describe("writeCodexHooks malformed valid JSON shape", () => {
  beforeEach(() => vol.reset());

  it("throws a native filter error when an existing event groups value is null", () => {
    vol.fromJSON({ "/repo/.codex/hooks.json": JSON.stringify({ hooks: { Stop: null } }) }, "/");

    expect(() => writeCodexHooks("/repo/.codex/hooks.json", [], "run"))
      .toThrowError(/filter/);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming the write path throws the native `filter` failure. Remove the disposable probe after running it.

## Observed Behavior

For an existing file containing `{ "hooks": { "Stop": null } }`, `writeCodexHooks("/repo/.codex/hooks.json", [], "run")` throws `TypeError: groups.filter is not a function`. `parseHooksFile()` only parses and casts JSON at `packages/agent-hook-config/src/write-hooks.ts:26`, while `removeGeneratedHandlers()` blindly invokes `groups.filter(...)` at `packages/agent-hook-config/src/write-hooks.ts:56` through `packages/agent-hook-config/src/write-hooks.ts:74`.

## Expected Behavior

Hook configuration writing should validate that existing event hook values are arrays before mutating them and throw a controlled configuration error identifying the malformed file or event. Structurally invalid but valid JSON should not surface internal array-method exceptions.

## Impact

A hand-edited, corrupted, or tool-generated `.codex/hooks.json` file can prevent hook installation or regeneration with an opaque native error. Because the failure occurs on the writer API rather than discovery alone, users cannot repair or replace generated hooks through normal configuration flows without first diagnosing the malformed field manually.
