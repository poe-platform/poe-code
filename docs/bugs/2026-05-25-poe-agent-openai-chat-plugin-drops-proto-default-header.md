---
name: "Poe Agent OpenAI Chat Plugin Drops a `__proto__` Default Header"
---

# Poe Agent OpenAI Chat Plugin Drops a `__proto__` Default Header

## Summary

The built-in `openai-chat-completions` plugin configuration parser accepts a `defaultHeaders` object with a header named `__proto__`, but silently removes that configured header from the parsed plugin options. It validates and copies arbitrary header names into an ordinary object with bracket assignment.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/plugins/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { builtinPluginRegistry } from "./registry.js";

describe("OpenAI chat completions special default header names", () => {
  it("drops an explicit __proto__ configured default header", () => {
    const spec = builtinPluginRegistry.get("openai-chat-completions");
    const options = spec!.parseOptions({
      defaultHeaders: JSON.parse('{"__proto__":"visible"}')
    }) as { defaultHeaders?: Record<string, string> };

    expect(Object.hasOwn(options.defaultHeaders!, "__proto__")).toBe(false);
    expect(options.defaultHeaders).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/plugins/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that accepted plugin configuration loses the declared header. Remove the disposable probe after validation.

## Observed Behavior

`builtinPluginRegistry.get("openai-chat-completions")!.parseOptions(...)` returns `defaultHeaders: {}` after receiving an own `__proto__: "visible"` header. In `packages/poe-agent/src/plugins/poe-agent-plugin-openai-chat-completions.ts`, `readOptionalStringRecord()` accepts object entries after validating each value as a string, initializes `record` as `{}`, and copies each key with `record[entryKey] = entryValue`.

## Expected Behavior

Default request header configuration accepted by the built-in OpenAI chat plugin should preserve every declared string header as inert configuration data, including a key named `__proto__`, or reject unsupported header names explicitly.

## Impact

Agents configured through the public plugin system can silently start without a caller-specified default request header. This creates a mismatch between accepted plugin configuration and outbound provider behavior, potentially breaking routing, tracing, authentication, or gateway requirements.
