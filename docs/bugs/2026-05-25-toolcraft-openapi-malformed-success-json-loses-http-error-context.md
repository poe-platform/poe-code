---
name: "Toolcraft OpenAPI malformed success JSON loses HTTP error context"
---

# Toolcraft OpenAPI malformed success JSON loses HTTP error context

## Summary

The exported `toolcraft-openapi` `requestJson()` API represents non-JSON success responses and unsuccessful responses through its contextual `HttpError` type, including request URL and response metadata. However, when a server responds with HTTP success and declares JSON while returning malformed JSON, `requestJson()` lets a raw `SyntaxError` escape from `JSON.parse()`, dropping the request and response context needed to diagnose the bad API response.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpError, requestJson } from "./http.js";

describe("malformed successful JSON response", () => {
  it("throws a raw SyntaxError without preserving HTTP request or response context", async () => {
    let caught: unknown;

    try {
      await requestJson({
        baseUrl: "https://api.example.test",
        path: "/bots",
        method: "GET",
        auth: "required",
        tokenSource: { getToken: async () => "token" },
        fetch: vi.fn(async () => new Response('{"bots":', {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" }
        }))
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SyntaxError);
    expect(caught).not.toBeInstanceOf(HttpError);
    expect(String(caught)).not.toContain("https://api.example.test/bots");
  });
});
```

Run the targeted probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft-openapi/src/__probe__.test.ts
```

The observed run is:

```text
✓ packages/toolcraft-openapi/src/__probe__.test.ts > malformed successful JSON response > throws a raw SyntaxError without preserving HTTP request or response context
```

## Observed Behavior

The server response has status `200 OK`, `Content-Type: application/json`, and malformed body `{"bots":`. Instead of throwing an `HttpError` with the method, URL, status, headers, and raw response body, `requestJson()` rejects with a plain `SyntaxError` whose message does not identify `https://api.example.test/bots`. In `packages/toolcraft-openapi/src/http.ts`, the method constructs `request` and `responseHeaders`, uses `HttpError` for a successful non-JSON content type, and uses `HttpError` for all unsuccessful responses, but directly evaluates `JSON.parse(text)` on the JSON-declared success branch without wrapping parser failure.

## Expected Behavior

A malformed JSON payload from an HTTP success response should reject through the same contextual API error surface used for other invalid or failed responses. The thrown error should retain request URL, HTTP status, response headers, and the unusable body or parser failure so consumers can identify the responsible endpoint and response.

## Impact

Generated clients and SDK integrations receiving a truncated, proxied, or malformed JSON success payload see an uncontextualized JavaScript parsing failure instead of an actionable HTTP/API error. This removes endpoint and response details from diagnostics and makes it substantially harder to debug server regressions, gateway corruption, or intermittent partial responses.
