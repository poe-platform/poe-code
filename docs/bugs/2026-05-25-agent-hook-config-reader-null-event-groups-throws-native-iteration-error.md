# Agent hook config reader null event groups throws native iteration error

## Summary

The exported `@poe-code/agent-hook-config` `readClaudeHooks()` API parses syntactically valid Claude settings JSON without validating the nested hooks shape before iterating it. A settings file containing an event whose value is `null` causes a native non-iterable exception rather than a controlled malformed-configuration error.

## Reproduction

Create a disposable Vitest probe at `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { readClaudeHooks } = await import("./read-hooks.js");

describe("readClaudeHooks malformed valid JSON shape", () => {
  beforeEach(() => vol.reset());

  it("throws a native iteration error when an event groups value is null", () => {
    vol.fromJSON({ "/repo/.claude/settings.json": JSON.stringify({ hooks: { Stop: null } }) }, "/");

    expect(() => readClaudeHooks("/repo", "/home", { scope: "project" }))
      .toThrowError(/not iterable/i);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-hook-config/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/agent-hook-config/src/__probe__.test.ts > readClaudeHooks malformed valid JSON shape > throws a native iteration error when an event groups value is null
```

## Observed Behavior

Reading a project settings document whose complete JSON is `{ "hooks": { "Stop": null } }` throws an engine-generated error indicating that the `groups` value is not iterable. The package does not identify the settings file or the malformed `hooks.Stop` shape in its failure.

`packages/agent-hook-config/src/read-hooks.ts:29` through `packages/agent-hook-config/src/read-hooks.ts:49` validate only JSON syntax and cast the parsed result to `ClaudeSettings`. `readClaudeHooks()` then loops over `Object.entries(settings.hooks ?? {})` and immediately executes `for (const group of groups)` at `packages/agent-hook-config/src/read-hooks.ts:51` through `packages/agent-hook-config/src/read-hooks.ts:77`. Because valid JSON can contain `null` for an event, that unchecked iteration throws a native runtime exception.

## Expected Behavior

Hook configuration loading should validate that each event contains an array of matcher groups and report a controlled configuration error naming the invalid settings location. Structurally invalid but syntactically valid JSON should not leak incidental iteration errors.

## Impact

A corrupted or hand-edited Claude hook settings file can make hook discovery and bridge setup fail with an opaque runtime message rather than an actionable diagnostic. Users cannot quickly locate the invalid field, and higher-level spawn workflows may fail before installing hooks or reporting useful remediation guidance.
