---
name: "Toolcraft OpenAPI HttpError retains query credentials in request URL"
---

# Toolcraft OpenAPI HttpError retains query credentials in request URL

## Summary

`@poe-code/toolcraft-openapi` redacts bearer authorization headers when it constructs its exported `HttpError`, but it retains the full request URL unchanged. When an API operation authenticates through query parameters, any failed request exposes those credentials through `error.request.url` and the default error message.

## Reproduction

Add the following temporary probe as `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { HttpError, requestJson } from "./http.js";

describe("failed request query credentials", () => {
  it("stores query tokens in the exported HttpError request URL", async () => {
    let captured: unknown;
    try {
      await requestJson({
        baseUrl: "https://api.example.test",
        path: "/items",
        method: "GET",
        auth: "none",
        tokenSource: { async getToken() { return undefined; } },
        query: { access_token: "error-secret-token" },
        fetch: async () => new Response("forbidden", { status: 403, statusText: "Forbidden" })
      });
    } catch (error) {
      captured = error;
    }

    console.log(JSON.stringify({ url: (captured as HttpError).request.url }));
    expect(captured).toBeInstanceOf(HttpError);
    expect((captured as HttpError).request.url).toContain("error-secret-token");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"url":"https://api.example.test/items?access_token=error-secret-token"}
✓ packages/toolcraft-openapi/src/__probe__.test.ts > failed request query credentials > stores query tokens in the exported HttpError request URL
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The `HttpError` object retains `access_token=error-secret-token` verbatim in `request.url`. In `packages/toolcraft-openapi/src/http.ts`, `createHttpErrorRequest()` passes the already query-expanded URL through unchanged while applying `redactHeaders()` only to request headers. The `HttpError` constructor also embeds `args.request.url` in its default error message, broadening the disclosure surface whenever the exception is logged or displayed.

## Expected Behavior

Structured HTTP errors should sanitize credential-bearing URL query parameters before storing or formatting the failed request. Sensitive query values must be redacted consistently with authorization headers so callers can safely inspect or log errors.

## Impact

Any API failure involving query-based credentials can place live secrets into exception objects, application logs, failure telemetry, CLI error rendering, and agent transcripts. Failures are especially likely to be logged, so this disclosure can expose credentials precisely during troubleshooting and incident analysis.
