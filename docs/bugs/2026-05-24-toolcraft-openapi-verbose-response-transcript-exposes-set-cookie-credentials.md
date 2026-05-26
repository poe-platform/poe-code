# Toolcraft OpenAPI verbose response transcript exposes Set-Cookie credentials

## Summary

`@poe-code/toolcraft-openapi` redacts outgoing bearer authorization values in verbose request traces, but it prints response headers without sanitization. If an API response sets an authenticated session cookie, enabling verbose output emits that cookie credential in plaintext to stderr.

## Reproduction

Add the following temporary probe as `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { requestJson } from "./http.js";

describe("verbose response credential headers", () => {
  it("prints set-cookie credentials without redaction", async () => {
    let transcript = "";
    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/session",
      method: "GET",
      auth: "none",
      tokenSource: { async getToken() { return undefined; } },
      verbose: true,
      writeStderr: (chunk) => { transcript += chunk; },
      fetch: async () => new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "session=secret-cookie; HttpOnly" }
      })
    });

    console.log(JSON.stringify({ transcript }));
    expect(transcript).toContain("secret-cookie");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"transcript":"→ GET https://api.example.test/session\n← 200 \n    content-type: application/json\n    set-cookie: session=secret-cookie; HttpOnly\n    {}\n"}
✓ packages/toolcraft-openapi/src/__probe__.test.ts > verbose response credential headers > prints set-cookie credentials without redaction
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The verbose transcript emits `set-cookie: session=secret-cookie; HttpOnly` unchanged. In `packages/toolcraft-openapi/src/http.ts`, request formatting applies `redactHeaderValue()` to outgoing headers, but `formatVerboseResponseTranscript()` renders every serialized response header value directly with no redaction pass.

## Expected Behavior

Verbose response transcripts should redact sensitive response headers, including `Set-Cookie` and comparable credential-bearing fields, before rendering diagnostics. The redaction safety applied to outgoing authentication must also protect secrets issued by the server.

## Impact

Enabling verbose diagnostics for login, session-establishing, or authenticated API calls can leak active cookies into terminal scrollback, CI logs, error captures, and model-visible transcripts. Those cookie values may allow session reuse or account access if exposed beyond the intended client.
