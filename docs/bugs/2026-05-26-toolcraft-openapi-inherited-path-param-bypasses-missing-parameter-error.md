# Toolcraft OpenAPI inherited path param bypasses missing-parameter error

## Summary

The public `toolcraft-openapi` HTTP runtime resolves required path-template parameters through ordinary property access on the supplied `pathParams` object. If a required parameter is named `constructor` and the caller provides no own value, the runtime reads inherited `Object.prototype.constructor`, stringifies it, and sends a request to a corrupted URL instead of rejecting the missing required parameter.

## Reproduction

Create the disposable probe `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { requestJson } from "./http.js";

describe("inherited OpenAPI path params", () => {
  it("uses inherited constructor instead of rejecting a missing required parameter", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));

    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/items/{constructor}",
      method: "GET",
      tokenSource: { getToken: async () => "unused" },
      auth: "none",
      pathParams: {},
      fetch
    });

    const url = String(fetch.mock.calls[0]?.[0]);
    console.log(url);
    expect(url).toBe(
      "https://api.example.test/items/function%20Object()%20%7B%20%5Bnative%20code%5D%20%7D"
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

Result:

```text
https://api.example.test/items/function%20Object()%20%7B%20%5Bnative%20code%5D%20%7D
✓ packages/toolcraft-openapi/src/__probe__.test.ts > inherited OpenAPI path params > uses inherited constructor instead of rejecting a missing required parameter
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

`requestJson()` in `packages/toolcraft-openapi/src/http.ts` builds the URL before performing its fetch. `substitutePathParams()` resolves each template key with `const value = pathParams?.[key];` and rejects only `value === undefined`. For `path: "/items/{constructor}"` and `pathParams: {}`, ordinary property lookup yields inherited `Object.prototype.constructor` rather than `undefined`. The runtime stringifies and percent-encodes that function into the request path, and the mocked server receives a request for `/items/function%20Object()%20%7B%20%5Bnative%20code%5D%20%7D`.

## Expected Behavior

Required OpenAPI path parameters should be satisfied only by explicit caller-supplied own values. If `{constructor}` is not present as an own `pathParams` property, `requestJson()` should raise its missing-path-parameter `UserError` and must not issue any HTTP request.

## Impact

Generated or runtime-integrated API clients can silently send requests to the wrong resource when an operation uses a special parameter name and the caller omits it. Instead of a local validation error, services receive malformed paths containing JavaScript function text, complicating debugging and potentially targeting unintended routes.
