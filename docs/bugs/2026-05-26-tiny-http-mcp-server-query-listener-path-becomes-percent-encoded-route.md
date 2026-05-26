# Tiny HTTP MCP server query listener path becomes percent-encoded route

## Summary

The public `tiny-http-mcp-server` `listenHttp()` API accepts a `path` option containing a query string such as `"/mcp?tenant=demo"`, but it does not listen at `/mcp` with that query. Instead, it treats the full string as pathname data, publishes `/mcp%3Ftenant=demo`, and returns `404` for a request to the configured query-bearing endpoint.

## Reproduction

From the repository root, create and run this disposable Vitest probe:

```sh
cat > packages/tiny-http-mcp-server/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer, nodeFetch } from "./index.js";

describe("HTTP listener query-bearing endpoint path", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
  });

  it("publishes a percent-encoded route rather than the configured query path", async () => {
    const server = createHttpServer({ name: "probe", version: "1" });
    const handle = await server.listenHttp({
      hostname: "127.0.0.1",
      port: 0,
      path: "/mcp?tenant=demo"
    });
    close = handle.close;

    const advertised = new URL(handle.url);
    const intended = await nodeFetch(`http://127.0.0.1:${handle.port}/mcp?tenant=demo`, {
      method: "GET"
    });
    console.log(JSON.stringify({
      url: handle.url,
      pathname: advertised.pathname,
      search: advertised.search,
      intendedStatus: intended.status
    }));

    expect(advertised.pathname).toBe("/mcp%3Ftenant=demo");
    expect(advertised.search).toBe("");
    expect(intended.status).toBe(404);
  });
});
EOF
npm exec -- vitest run packages/tiny-http-mcp-server/src/__probe__.test.ts --reporter verbose
rm packages/tiny-http-mcp-server/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"url":"http://127.0.0.1:<port>/mcp%3Ftenant=demo","pathname":"/mcp%3Ftenant=demo","search":"","intendedStatus":404}
```

## Observed Behavior

Calling `listenHttp({ path: "/mcp?tenant=demo" })` succeeds and returns a published server URL whose pathname is `/mcp%3Ftenant=demo` and whose query string is empty. A request to the caller-supplied endpoint shape `/mcp?tenant=demo` is not routed to the server and receives HTTP `404`.

`normalizePath()` in `packages/tiny-http-mcp-server/src/http-server.ts:79` through `packages/tiny-http-mcp-server/src/http-server.ts:87` treats its option as an opaque pathname string and retains the query delimiter. `listenHttp()` stores that result at `packages/tiny-http-mcp-server/src/http-server.ts:212` through `packages/tiny-http-mcp-server/src/http-server.ts:243`, matching incoming requests only against `requestUrl.pathname`. It builds the returned endpoint URL through `buildUrl()`, which assigns the complete option string to `url.pathname` at `packages/tiny-http-mcp-server/src/http-server.ts:106` through `packages/tiny-http-mcp-server/src/http-server.ts:113`; standard URL serialization therefore encodes `?` as literal pathname data.

## Expected Behavior

The HTTP listener should reject query- or fragment-bearing `path` options as invalid endpoint paths, or parse and honor them explicitly if supported. It must not accept a requested endpoint shape and silently publish a different percent-encoded pathname.

## Impact

SDK users configuring tenant-specific, test-specific, or otherwise query-qualified MCP endpoints can start a server that advertises and serves an unexpected route. Clients connecting to the configured URL receive `404`, while diagnostics expose a subtly rewritten endpoint, turning configuration mistakes into confusing transport failures.
