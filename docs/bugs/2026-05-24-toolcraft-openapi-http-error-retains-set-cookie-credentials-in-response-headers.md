# Toolcraft OpenAPI HttpError retains Set-Cookie credentials in response headers

## Summary

`@poe-code/toolcraft-openapi` exposes structured failed-response details through `HttpError.response.headers`, but it stores response header values without redaction. A failed response carrying `Set-Cookie` therefore embeds session credentials directly in the thrown error object.

## Reproduction

Add the following temporary probe as `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { HttpError, requestJson } from "./http.js";

describe("failed response credential headers", () => {
  it("stores set-cookie credentials in the exported HttpError response", async () => {
    let captured: unknown;
    try {
      await requestJson({
        baseUrl: "https://api.example.test",
        path: "/session",
        method: "GET",
        auth: "none",
        tokenSource: { async getToken() { return undefined; } },
        fetch: async () => new Response("denied", {
          status: 403,
          statusText: "Forbidden",
          headers: { "set-cookie": "session=error-cookie; HttpOnly" }
        })
      });
    } catch (error) {
      captured = error;
    }

    console.log(JSON.stringify({ headers: (captured as HttpError).response.headers }));
    expect(captured).toBeInstanceOf(HttpError);
    expect((captured as HttpError).response.headers["set-cookie"]).toContain("error-cookie");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"headers":{"content-type":"text/plain;charset=UTF-8","set-cookie":"session=error-cookie; HttpOnly"}}
✓ packages/toolcraft-openapi/src/__probe__.test.ts > failed response credential headers > stores set-cookie credentials in the exported HttpError response
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The exported `HttpError` retains `set-cookie: session=error-cookie; HttpOnly` as plain data. In `packages/toolcraft-openapi/src/http.ts`, failed responses pass `serializeHeaders(response.headers)` directly into `response.headers`, whereas the request-side equivalent explicitly applies `redactHeaders()` before exposing headers in the error object.

## Expected Behavior

Structured failed-response metadata should redact session cookies and other credential-bearing response headers before they are attached to an exported exception. Callers must be able to inspect or log API failures without leaking server-issued authentication material.

## Impact

Applications that log, serialize, report, or forward `HttpError` instances after failed authenticated requests can disclose live session cookies. This creates a secret-exposure risk in telemetry, issue reports, CI logs, and agent debugging output even when verbose tracing is disabled.
