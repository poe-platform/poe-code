# Toolcraft OpenAPI dry-run preview exposes query credentials

## Summary

`@poe-code/toolcraft-openapi` implements dry-run HTTP previews that avoid making network requests and redact bearer authorization headers, but the preview prints complete URLs with unsanitized query parameters. A dry run of an operation using query-based API credentials exposes those secrets in plaintext to stdout.

## Reproduction

Add the following temporary probe as `packages/toolcraft-openapi/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { requestJson } from "./http.js";

describe("dry-run query credentials", () => {
  it("prints query tokens without performing a request", async () => {
    let output = "";
    const fetch = async () => { throw new Error("fetch should not run"); };

    await requestJson({
      baseUrl: "https://api.example.test",
      path: "/items",
      method: "GET",
      auth: "none",
      tokenSource: { async getToken() { return undefined; } },
      query: { api_key: "dry-secret-token" },
      dryRun: true,
      writeStdout: (chunk) => { output += chunk; },
      fetch
    });

    console.log(JSON.stringify({ output }));
    expect(output).toContain("dry-secret-token");
  });
});
```

Run:

```sh
npm exec vitest run -- packages/toolcraft-openapi/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"output":"GET https://api.example.test/items?api_key=dry-secret-token\n\n"}
✓ packages/toolcraft-openapi/src/__probe__.test.ts > dry-run query credentials > prints query tokens without performing a request
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

Dry-run output includes `api_key=dry-secret-token` in plaintext even though no request is sent. `requestJson()` in `packages/toolcraft-openapi/src/http.ts` builds the full query-bearing URL before its dry-run early return, and `formatDryRunOutput()` writes the request line unchanged while only redacting qualifying header values.

## Expected Behavior

Dry-run previews should be safe to display and log: credential-bearing query parameters should be redacted just as bearer headers are. Previewing an API operation must not reveal API keys, access tokens, signatures, or other sensitive URL values.

## Impact

Users frequently run dry-run commands specifically to inspect planned actions safely. Query-authenticated OpenAPI commands instead disclose their credentials in terminal output, CI preview logs, and captured agent context before any operation executes, undermining the safety expectation of dry-run mode.
