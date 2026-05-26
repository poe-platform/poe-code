# Tiny OAuth test server CLI labels authorization-server metadata as PRM

## Summary

The `tiny-oauth-test-server` CLI prints an RFC 8414 authorization-server metadata endpoint under the label `PRM metadata URL`. Protected resource metadata (PRM) is a different discovery document, so users following the CLI output as labeled are directed to metadata that describes the authorization server rather than a protected resource.

## Reproduction

Create a disposable Vitest probe at `packages/tiny-oauth-test-server/src/__probe__.test.ts`:

```ts
import http from "node:http";
import { describe, expect, it } from "vitest";
import { runCli } from "./cli.js";

function readJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(JSON.parse(body) as Record<string, unknown>));
    }).once("error", reject);
  });
}

describe("tiny OAuth CLI metadata label", () => {
  it("prints an authorization-server metadata document as the PRM URL", async () => {
    let stdout = "";
    let metadata: Record<string, unknown> | undefined;

    const exitCode = await runCli(["--port", "0", "--hostname", "127.0.0.1"], {
      stdout: { write(chunk) { stdout += String(chunk); return true; } },
      stderr: { write() { return true; } },
      async waitForShutdown(close) {
        const printedUrl = stdout.match(/^PRM metadata URL: (.+)$/m)?.[1];
        expect(printedUrl).toBeDefined();
        metadata = await readJson(printedUrl!);
        await close();
      }
    });

    expect(exitCode).toBe(0);
    expect(metadata).toHaveProperty("authorization_endpoint");
    expect(metadata).not.toHaveProperty("resource");
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
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth CLI metadata label > prints an authorization-server metadata document as the PRM URL
```

## Observed Behavior

`runCli()` constructs `metadataUrl` using `/.well-known/oauth-authorization-server` and prints it as `PRM metadata URL` at `packages/tiny-oauth-test-server/src/cli.ts:243` through `packages/tiny-oauth-test-server/src/cli.ts:250`. The server handles that path as authorization-server metadata at `packages/tiny-oauth-test-server/src/index.ts:388` through `packages/tiny-oauth-test-server/src/index.ts:411` and `packages/tiny-oauth-test-server/src/index.ts:851` through `packages/tiny-oauth-test-server/src/index.ts:854`. Fetching the printed URL returns an authorization metadata document containing fields such as `authorization_endpoint`, not protected-resource metadata containing a `resource` identifier.

## Expected Behavior

The CLI should identify the printed endpoint accurately, for example as `Authorization server metadata URL`, or expose a real protected-resource metadata endpoint only when the fixture provides a protected resource to describe. It should not label RFC 8414 authorization-server discovery as PRM.

## Impact

Users and automated smoke instructions can copy the printed `PRM metadata URL` into MCP/OAuth protected-resource discovery checks and receive the wrong document shape. This creates misleading integration failures, obscures whether a resource server is publishing RFC 9728 metadata, and makes the test fixture's startup diagnostics unreliable for debugging OAuth discovery flows.
