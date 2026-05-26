# Tiny OAuth test server CLI prints unreachable metadata URL for path issuer

## Summary

The `tiny-oauth-test-server` CLI accepts an issuer URL with a non-root path such as `/oauth`, but constructs its printed metadata link by appending `/.well-known/oauth-authorization-server` after that issuer path. The server actually exposes authorization-server metadata at the well-known path prefixed before the issuer path, so the URL printed at startup returns `404` for a supported custom issuer configuration.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";

function request(url: string): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    }).once("error", reject);
  });
}

describe("tiny OAuth CLI custom issuer metadata URL", () => {
  it("prints an unreachable metadata URL when the issuer has a base path", async () => {
    let stdout = "";
    let printedResponse: { status: number | undefined; body: string } | undefined;

    const portServer = http.createServer();
    await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
    const address = portServer.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    const port = address.port;
    await new Promise<void>((resolve) => portServer.close(() => resolve()));

    const exitCode = await runCli([
      "--port", String(port),
      "--hostname", "127.0.0.1",
      "--issuer", `http://127.0.0.1:${port}/oauth`
    ], {
      stdout: { write(chunk) { stdout += String(chunk); return true; } },
      stderr: { write() { return true; } },
      async waitForShutdown(close) {
        const printedUrl = stdout.match(/^PRM metadata URL: (.+)$/m)?.[1];
        expect(printedUrl).toBeDefined();
        printedResponse = await request(printedUrl!);
        await close();
      }
    });

    expect(exitCode).toBe(0);
    expect(printedResponse?.status).toBe(404);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth CLI custom issuer metadata URL > prints an unreachable metadata URL when the issuer has a base path
```

## Observed Behavior

For `--issuer http://127.0.0.1:<port>/oauth`, `runCli()` prints a metadata link formed as ```${server.issuer}/.well-known/oauth-authorization-server``` at `packages/tiny-oauth-test-server/src/cli.ts:243` through `packages/tiny-oauth-test-server/src/cli.ts:250`, which yields `/oauth/.well-known/oauth-authorization-server`. The server derives the supported RFC 8414 endpoint for a non-root issuer as `/.well-known/oauth-authorization-server/oauth` at `packages/tiny-oauth-test-server/src/index.ts:388` through `packages/tiny-oauth-test-server/src/index.ts:411` and only serves that derived path at `packages/tiny-oauth-test-server/src/index.ts:851` through `packages/tiny-oauth-test-server/src/index.ts:854`. Fetching the CLI's printed URL therefore receives HTTP `404`.

## Expected Behavior

Startup output should print the metadata endpoint that the fixture actually serves for every accepted issuer URL. For a non-root issuer path, the CLI should derive the RFC 8414 well-known URL using the same route logic as the server, rather than appending a suffix to the issuer string.

## Impact

Integration tests and users running the fixture with a realistic path-based authorization-server issuer are given a dead discovery URL at startup. Clients configured from the CLI diagnostics fail metadata discovery before reaching authorization, producing misleading `404` failures even though the server was started with a valid supported issuer and exposes working metadata at a different path.
