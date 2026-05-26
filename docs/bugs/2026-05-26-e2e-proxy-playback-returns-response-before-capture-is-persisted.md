# E2E proxy playback returns response before capture is persisted

## Summary

The `@poe-code/e2e-test-runner` proxy server sends successful playback-hit and playback-miss-error responses without awaiting the corresponding capture-log append. A caller can therefore receive a completed response while the request's audit exchange is still unwritten, and a later capture failure cannot be reported through the already completed request.

## Reproduction

Create a disposable Vitest probe at `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const captureFile = "/tmp/proxy-capture.jsonl";
let releaseCapture: (() => void) | undefined;

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    appendFile: vi.fn(async (path: unknown, data: unknown, options?: unknown) => {
      if (path === captureFile) {
        await new Promise<void>((resolve) => {
          releaseCapture = resolve;
        });
        return;
      }
      await fs.promises.appendFile(path as never, data as never, options as never);
    })
  };
});

const { startProxyServer } = await import("./proxy-server.js");

async function networkFetch(url: string, body: string): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      method: "POST",
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname,
      headers: { "content-type": "application/json" }
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode ?? 500
      })));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

describe("playback capture persistence ordering", () => {
  it("returns a successful playback response while capture logging remains blocked", async () => {
    vol.reset();
    vol.mkdirSync("/tmp/snapshots", { recursive: true });
    const payload = { model: "demo", messages: [{ role: "user", content: "hello" }] };
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
    vol.writeFileSync(`/tmp/snapshots/demo-${hash}.json`, JSON.stringify({ response: { id: "saved" } }));
    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: "http://unused.test", mode: "playback", snapshotDir: "/tmp/snapshots" }]
    });

    try {
      const response = await networkFetch(`${proxy.url}/v1/chat/completions`, JSON.stringify(payload));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ id: "saved" });
      expect(releaseCapture).toEqual(expect.any(Function));
      expect(vol.existsSync(captureFile)).toBe(false);
    } finally {
      releaseCapture?.();
      await proxy.close();
    }
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
rm -f packages/e2e-test-runner/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > playback capture persistence ordering > returns a successful playback response while capture logging remains blocked
```

## Observed Behavior

For a playback request satisfied from an existing snapshot, the client receives status `200` and body `{ "id": "saved" }` even though the mocked `appendFile()` for `captureFile` remains unresolved and the capture file has not been created.

In `packages/e2e-test-runner/src/proxy-server.ts:251` through `packages/e2e-test-runner/src/proxy-server.ts:264`, `captureAndRespond()` initiates `appendFile(config.captureFile, ...)` with `void` and immediately calls `writeJson()`. The playback-hit path invokes that helper at `packages/e2e-test-runner/src/proxy-server.ts:270` through `packages/e2e-test-runner/src/proxy-server.ts:278`; the playback `onMiss === "error"` path does the same at `packages/e2e-test-runner/src/proxy-server.ts:283` through `packages/e2e-test-runner/src/proxy-server.ts:286`. By contrast, passthrough and record branches explicitly `await appendFile()` before responding at `packages/e2e-test-runner/src/proxy-server.ts:297` through `packages/e2e-test-runner/src/proxy-server.ts:323`.

## Expected Behavior

Playback request completion should obey the same capture persistence contract as the other proxy paths: either await the exchange append before returning success/error to the caller, or explicitly surface that capture logging is best-effort and safely contain append failures. A completed recorded request should not leave its audit record pending outside the response lifecycle.

## Impact

Playback-based tests and diagnostics can appear to complete successfully before their captured evidence exists. If the asynchronous append later rejects because of storage errors or shutdown timing, the request outcome cannot communicate the lost audit record and the unobserved rejected promise can become a process-level failure, making playback transcripts incomplete and reliability format-dependent by route path.
