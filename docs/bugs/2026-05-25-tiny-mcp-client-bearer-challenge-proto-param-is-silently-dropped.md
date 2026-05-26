# Tiny MCP Client Bearer Challenge `__proto__` Parameter Is Silently Dropped

## Summary

The exported `parseBearerWwwAuthenticateHeader()` parser accepts a Bearer authentication parameter named `__proto__` but silently omits it from the returned `params` object. The parser stores arbitrary parameter names into an ordinary object with bracket assignment, so `__proto__` changes the intermediate object's prototype rather than being preserved as an own parsed parameter.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-mcp-client/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBearerWwwAuthenticateHeader } from "./oauth-discovery.js";

describe("Bearer challenge special auth-param names", () => {
  it("drops an explicit __proto__ parameter from parsed output", () => {
    const challenge = parseBearerWwwAuthenticateHeader('Bearer __proto__="visible"');

    expect(challenge?.scheme).toBe("Bearer");
    expect(Object.hasOwn(challenge!.params, "__proto__")).toBe(false);
    expect(challenge?.params).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/tiny-mcp-client/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the parsed parameter disappears. Remove the disposable probe after validation.

## Observed Behavior

`parseBearerWwwAuthenticateHeader('Bearer __proto__="visible"')` returns a Bearer challenge, but its `params` object has no own `__proto__` property and is equal to `{}`. In `packages/tiny-mcp-client/src/oauth-discovery.ts`, auth-params are assigned with `params[parsedParam.name] = parsedParam.value` after initializing `params` as `{}`.

## Expected Behavior

The parser should preserve each syntactically accepted authentication parameter as inert parsed data, including a parameter named `__proto__`, or explicitly reject that name instead of silently returning an incomplete challenge.

## Impact

OAuth discovery and callers of the exported parser can receive incomplete authentication challenge data while parsing appears successful. This can hide server-provided challenge parameters from diagnostic, interoperability, or validation logic and makes special-key Bearer challenges impossible to inspect faithfully.
