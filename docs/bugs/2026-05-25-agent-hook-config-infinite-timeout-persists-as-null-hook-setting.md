# Agent Hook Config infinite timeout persists as null hook setting

## Summary

The exported `@poe-code/agent-hook-config` `writeCodexHooks()` API accepts a generated command hook whose typed `timeout` field is `number`, but does not reject non-finite values. Writing a hook with `timeout: Infinity` succeeds and persists `timeout: null` in `.codex/hooks.json`, silently changing the requested setting while reporting a successful hook publication.

## Reproduction

Create the disposable probe `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { writeCodexHooks } = await import("./index.js");

describe("Codex hook non-finite timeout publication", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("silently persists Infinity as null in a generated hook", () => {
    writeCodexHooks(
      "/repo/.codex/hooks.json",
      [
        {
          event: "Stop",
          handler: {
            type: "command",
            command: "notify",
            timeout: Number.POSITIVE_INFINITY,
            statusMessage: "[generated:probe] notify"
          },
          generatedId: "generated-probe-0"
        }
      ],
      "probe"
    );

    const persisted = JSON.parse(vol.readFileSync("/repo/.codex/hooks.json", "utf8") as string);
    console.log(JSON.stringify(persisted));
    expect(persisted.hooks.Stop[0].hooks[0].timeout).toBeNull();
  });
});
```

Run the targeted test and then remove the disposable probe:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-hook-config/src/__probe__.test.ts
```

The probe passes and prints the persisted hook document:

```text
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"notify","timeout":null,"statusMessage":"[generated:probe] notify"}]}]}}
✓ packages/agent-hook-config/src/__probe__.test.ts > Codex hook non-finite timeout publication > silently persists Infinity as null in a generated hook
```

## Observed Behavior

`GeneratedHookEntry.handler.timeout` is an optional `number` and the transformation path copies an input timeout into generated hooks without validation in `packages/agent-hook-config/src/transform-hooks.ts:73` and `packages/agent-hook-config/src/transform-hooks.ts:84`. The exported writer appends the supplied handler and serializes the full config with `JSON.stringify()` in `packages/agent-hook-config/src/write-hooks.ts:80` and `packages/agent-hook-config/src/write-hooks.ts:96`. JSON serialization converts `Infinity` to `null`, so a successful write persists a different, invalidly typed setting from the one accepted by the API.

## Expected Behavior

Hook publication should reject non-finite numeric timeouts before writing config, or define and preserve an explicit supported unlimited-timeout representation. It must not report success after silently converting a supplied numeric timeout into JSON `null`.

## Impact

SDK callers and hook-bridge inputs that calculate or deserialize an unbounded timeout can install corrupted Codex hook configuration while believing the requested timeout was retained. Downstream hook consumers may reject the `null` value, apply unintended timeout semantics, or fail to run automation and guardrail hooks during later agent sessions.
