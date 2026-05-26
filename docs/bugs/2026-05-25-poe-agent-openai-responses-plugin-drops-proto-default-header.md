# Poe Agent OpenAI Responses Plugin Drops a `__proto__` Default Header

## Summary

The built-in `openai-responses` plugin configuration parser accepts a `defaultHeaders` object with a header named `__proto__`, but silently removes that header from the parsed options used to construct the Responses provider. This independently affects the Responses plugin configuration boundary, separate from chat-completions plugin setup.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/plugins/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { builtinPluginRegistry } from "./registry.js";

describe("OpenAI responses special default header names", () => {
  it("drops an explicit __proto__ configured default header", () => {
    const spec = builtinPluginRegistry.get("openai-responses");
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

The probe passes, confirming that Responses provider configuration loses the declared default header. Remove the disposable probe after validation.

## Observed Behavior

`builtinPluginRegistry.get("openai-responses")!.parseOptions(...)` returns `defaultHeaders: {}` after receiving an own `__proto__: "visible"` header. In `packages/poe-agent/src/plugins/poe-agent-plugin-openai-responses.ts`, `readOptionalStringRecord()` validates each configured string header, initializes `record` as `{}`, and copies each dynamic key with `record[entryKey] = entryValue`.

## Expected Behavior

Default request header configuration accepted by the built-in OpenAI Responses plugin should preserve every declared string header as inert provider configuration data, including `__proto__`, or reject unsupported header names explicitly.

## Impact

Agents using the Responses provider can start with incomplete accepted header configuration. A caller-supplied gateway, tracing, routing, or authentication-related header may never reach provider requests, without an error identifying the discarded setting.
