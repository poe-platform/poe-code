# Tiny OAuth test server failed close cannot retry HTTP shutdown

## Summary

The `tiny-oauth-test-server` listening handle clears its active server state before its underlying HTTP server has successfully closed. If `http.Server.close()` reports a transient error, the public `handle.close()` rejects once, but a second call returns immediately without retrying the failed shutdown. The server can therefore remain bound while its cleanup handle has permanently lost the ability to close it.

## Reproduction

Create a disposable Vitest probe that makes the first HTTP-server close callback report an error and would allow a later retry to use the real close implementation:

```sh
cat > packages/tiny-oauth-test-server/src/__probe__.test.ts <<'EOF'
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createOAuthTestServer } from "./index.js";

describe("tiny OAuth failed close retry", () => {
  it("cannot retry a rejected HTTP server shutdown", async () => {
    const originalClose = http.Server.prototype.close;
    const close = vi.spyOn(http.Server.prototype, "close");
    close.mockImplementationOnce(function (_callback?: (error?: Error) => void) {
      _callback?.(new Error("close temporarily failed"));
      return this;
    });
    close.mockImplementation(function (callback?: (error?: Error) => void) {
      return originalClose.call(this, callback as never);
    });

    const server = createOAuthTestServer({ signingKeySeed: "failed-close" });
    const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });

    await expect(handle.close()).rejects.toThrow("close temporarily failed");
    await expect(handle.close()).resolves.toBeUndefined();

    expect(close).toHaveBeenCalledOnce();
  });
});
EOF
trap 'rm -f packages/tiny-oauth-test-server/src/__probe__.test.ts' EXIT
npm exec -- vitest run packages/tiny-oauth-test-server/src/__probe__.test.ts --reporter verbose
nl -ba packages/tiny-oauth-test-server/src/index.ts | sed -n '697,768p'
```

The probe passes:

```text
✓ packages/tiny-oauth-test-server/src/__probe__.test.ts > tiny OAuth failed close retry > cannot retry a rejected HTTP server shutdown
```

## Observed Behavior

The handle `close()` method obtains `activeServer`, then clears `server`, `currentHandle`, and the runtime issuer before awaiting the actual `activeServer.close(...)` callback at `packages/tiny-oauth-test-server/src/index.ts:736` through `packages/tiny-oauth-test-server/src/index.ts:764`. In the probe, the first close callback rejects with `close temporarily failed`, but the second call sees `server === null` and exits at `packages/tiny-oauth-test-server/src/index.ts:737` through `packages/tiny-oauth-test-server/src/index.ts:739`. The HTTP close spy is therefore called only once, although it would close successfully when retried.

## Expected Behavior

A listening handle should retain shutdown ownership until its underlying HTTP server has successfully closed. If close fails, callers should be able to retry the same handle, or the server should track failed cleanup state explicitly rather than treating an unclosed listener as already disposed.

## Impact

Transient HTTP shutdown failures in test teardown can leave authorization-server listeners and ports active while later cleanup attempts silently succeed without doing work. This may keep test processes alive, interfere with subsequent fixtures, or leave an OAuth endpoint reachable after callers believe disposal completed.
