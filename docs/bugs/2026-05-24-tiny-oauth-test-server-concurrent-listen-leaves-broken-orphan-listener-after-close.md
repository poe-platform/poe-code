# Tiny OAuth test server concurrent listen leaves broken orphan listener after close

## Summary

`tiny-oauth-test-server` allows two concurrent `listen()` calls to bind separate HTTP listeners before either call publishes the active handle state. Both calls return successfully, but the shared `server` and `currentHandle` references track only one listener. Closing the returned handles then leaves the other listener running while clearing its runtime issuer, so it remains bound but returns internal errors for metadata requests.

## Reproduction

From the repository root, run a disposable Vitest probe that starts two listeners concurrently, checks both metadata endpoints, invokes both close handles, and probes both ports again:

```sh
cat > /tmp/tiny-oauth-concurrent-listen-orphan-probe.test.ts <<'PROBE'
import http from "node:http";
import { describe, expect, it } from "vitest";
import { createOAuthTestServer } from "./index.js";

function status(urlString: string): Promise<string> {
  const url = new URL(urlString);
  return new Promise((resolve) => {
    const req = http.get({ hostname: url.hostname, port: Number(url.port), path: "/.well-known/oauth-authorization-server", agent: false }, (res) => { res.resume(); res.on("end", () => resolve(`reachable:${res.statusCode}`)); });
    req.on("error", () => resolve("closed"));
  });
}

describe("tiny OAuth concurrent listen orphan", () => {
  it("leaves one broken listener alive after both returned handles close", async () => {
    const server = createOAuthTestServer({ signingKeySeed: "probe" });
    const [first, second] = await Promise.all([server.listen({ port: 0, hostname: "127.0.0.1" }), server.listen({ port: 0, hostname: "127.0.0.1" })]);
    const before = await Promise.all([status(first.url), status(second.url)]);
    await first.close();
    await second.close();
    const after = await Promise.all([status(first.url), status(second.url)]);
    console.log(JSON.stringify({ distinct: first.port !== second.port, before, after, first: first.url, second: second.url }));
    expect(first.port).not.toBe(second.port);
    expect(before).toEqual(["reachable:200", "reachable:200"]);
    expect(after).toEqual(["reachable:500", "closed"]);
  });
});
PROBE
cp /tmp/tiny-oauth-concurrent-listen-orphan-probe.test.ts packages/tiny-oauth-test-server/src/__probe__.test.ts
trap 'rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

Both listeners initially serve valid metadata, but after both returned handles are closed, the first port is still listening and responds with HTTP `500` while the second is closed:

```text
{"distinct":true,"before":["reachable:200","reachable:200"],"after":["reachable:500","closed"],"first":"http://127.0.0.1:62349","second":"http://127.0.0.1:62350"}
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth concurrent listen orphan > leaves one broken listener alive after both returned handles close
```

`packages/tiny-oauth-test-server/src/index.ts:697` through `packages/tiny-oauth-test-server/src/index.ts:719` check shared listener state before awaiting asynchronous binding, allowing simultaneous calls to pass the guard. Each call later assigns the single shared `server`, `runtimeIssuer`, and `currentHandle` values at `packages/tiny-oauth-test-server/src/index.ts:726` through `packages/tiny-oauth-test-server/src/index.ts:768`. The close function consequently operates through whichever shared server reference remains current and clears the runtime issuer, leaving the other bound HTTP server orphaned and unable to generate metadata normally.

## Expected Behavior

Concurrent `listen()` attempts on one OAuth test-server instance should either serialize into one listener or reject all but one call. Closing all returned handles must close every listener created by the instance and must not leave a bound endpoint serving internal failures.

## Impact

Parallel tests or setup code can leak an HTTP listener and port after apparently completing teardown. The orphan endpoint remains externally reachable but broken, causing process-lifetime leaks, port contention, misleading test behavior, and unintended residual network exposure.
