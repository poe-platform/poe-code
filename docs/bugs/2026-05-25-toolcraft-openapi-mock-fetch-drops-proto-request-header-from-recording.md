---
name: "`mockFetch` Drops a `__proto__` Request Header From Recorded Requests"
---

# `mockFetch` Drops a `__proto__` Request Header From Recorded Requests

## Summary

The public `mockFetch()` request recorder silently drops an incoming header named `__proto__`. Its header normalization copies caller-controlled header names into an ordinary object with bracket assignment, so the special key updates the object's prototype instead of becoming a recorded own header field.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/mock/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mockFetch } from "./fetch.js";

describe("OpenAPI mock request special header names", () => {
  it("drops a received __proto__ header from recorded requests", async () => {
    const handle = await mockFetch({
      spec: {
        openapi: "3.0.0",
        info: { title: "Demo", version: "1" },
        paths: {
          "/ping": {
            get: {
              operationId: "ping",
              responses: { "200": { description: "ok" } }
            }
          }
        }
      },
      onUnmocked: "reply404"
    } as never);

    await handle.fetch("https://example.test/ping", {
      headers: new Headers([["__proto__", "visible"]])
    });

    expect(Object.hasOwn(handle.requests[0]!.headers, "__proto__")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/mock/__probe__.test.ts --reporter verbose
```

The test passes, confirming the loss. Remove the disposable probe after validation.

## Observed Behavior

After the request is recorded, `Object.hasOwn(handle.requests[0].headers, "__proto__")` is `false`, even though the request explicitly included a `__proto__` header value.

## Expected Behavior

Recorded requests should preserve every received header name and value, including special property names such as `__proto__`, without changing object prototype behavior.

## Impact

Tests and tooling that use `mockFetch()` cannot accurately assert or inspect requests containing this valid caller-supplied header name. The recording API silently produces incomplete request evidence, which can hide incorrect forwarding or validation behavior around special-key headers.
