# Toolcraft OpenAPI verbose request transcript exposes query credentials

## Summary

`@poe-code/toolcraft-openapi` explicitly redacts bearer authorization headers in request transcripts, but verbose mode logs the complete request URL without sanitizing query parameters. An API operation using query-based authentication or signed query metadata prints those credentials in plaintext to stderr.

## Reproduction

Add the following temporary probe as `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { requestJson } from "./http.js";

describe("verbose request query credentials", () => {
  it("prints query tokens without redaction", async () => {
    let transcript = "";
    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "GET",
      auth: "none",
      tokenSource: { async getToken() { return undefined; } },
      query: { access_token: "secret-query-token" },
      verbose: true,
      writeStderr: (chunk) => { transcript += chunk; },
      fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    });

    console.log(JSON.stringify({ transcript }));
    expect(transcript).toContain("secret-query-token");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"transcript":"→ GET https://api.example.test/items?access_token=secret-query-token\n← 200 \n    content-type: application/json\n    {}\n"}
✓ packages/toolcraft-openapi/src/__probe__.test.ts > verbose request query credentials > prints query tokens without redaction
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The verbose request transcript contains `access_token=secret-query-token` verbatim. In `packages/toolcraft-openapi/src/http.ts`, `buildRequestUrl()` appends query values to the request URL, and `formatVerboseRequestTranscript()` writes that full URL directly while only passing request header values through `redactHeaderValue()`. The package therefore protects bearer headers while leaving equivalent URL credentials visible.

## Expected Behavior

Verbose HTTP transcripts should redact secret-bearing query parameters using the same security intent applied to authorization headers, or provide a safe opt-in mechanism for explicitly non-sensitive query logging. Values such as `access_token`, API keys, signatures, and signed-URL tokens must not be emitted in plaintext diagnostics.

## Impact

Verbose debugging output can leak live API credentials or signed request parameters into terminal scrollback, CI logs, captured error artifacts, or model-visible transcripts. Users enabling diagnostics to investigate API behavior may unintentionally disclose the credentials protecting the request.
