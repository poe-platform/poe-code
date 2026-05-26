# E2E Proxy Record Capture Log Failure Returns Error After Committing Snapshot

## Summary

The `@poe-code/e2e-test-runner` proxy server persists a refreshed record-mode snapshot before it appends the corresponding capture-log exchange. If capture logging fails, the proxy reports request failure with status `502` even though the new playback fixture has already been durably committed.

## Reproduction

Create a disposable Vitest probe at `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http from "node:http";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

const captureFile = "/tmp/proxy-capture.jsonl";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async appendFile(path: Parameters<typeof fs.promises.appendFile>[0], data: Parameters<typeof fs.promises.appendFile>[1], options?: Parameters<typeof fs.promises.appendFile>[2]) {
      if (path === captureFile) {
        throw new Error("capture disk full");
      }
      await fs.promises.appendFile(path, data, options);
    }
  };
});

const { startProxyServer } = await import("./proxy-server.js");

async function networkFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  return await new Promise<Response>((resolve, reject) => {
    const request = http.request({
      method: init?.method ?? "GET",
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname,
      headers: init?.headers as Record<string, string> | undefined
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
    });
    request.on("error", reject);
    if (typeof init?.body === "string") {
      request.write(init.body);
    }
    request.end();
  });
}

function snapshotKey(payload: { model: string; messages: Array<{ role: string; content: string }> }): string {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
  return `${payload.model.toLowerCase()}-${hash}`;
}

describe("proxy record capture failure ordering", () => {
  it("returns an error after committing the refreshed playback fixture", async () => {
    vol.reset();
    const snapshotDir = "/tmp/proxy-snapshots";
    const payload = { model: "claude", messages: [{ role: "user", content: "same prompt" }] };
    const snapshotPath = join(snapshotDir, `${snapshotKey(payload)}.json`);
    vol.fromJSON({
      [snapshotPath]: JSON.stringify({ key: snapshotKey(payload), response: { id: "prior" } })
    });
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ id: "fresh" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const proxy = await startProxyServer({
      port: 0,
      captureFile,
      onMiss: "error",
      routes: [{ path: "/v1", target: "http://unused.test", mode: "record", snapshotDir }]
    });

    try {
      const response = await networkFetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const persisted = JSON.parse(vol.readFileSync(snapshotPath, "utf8") as string);
      console.log(JSON.stringify({ status: response.status, response: persisted.response }));
      expect(response.status).toBe(502);
      expect(persisted.response).toEqual({ id: "fresh" });
    } finally {
      await proxy.close();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"status":502,"response":{"id":"fresh"}}
✓ packages/e2e-test-runner/src/__probe__.test.ts > proxy record capture failure ordering > returns an error after committing the refreshed playback fixture
```

Remove the disposable probe after validation.

## Observed Behavior

For a record-mode route, `startProxyServer()` receives the upstream response and awaits `writeSnapshot()` at `packages/e2e-test-runner/src/proxy-server.ts:310` through `packages/e2e-test-runner/src/proxy-server.ts:313`. Only after that fixture replacement succeeds does it await `appendFile()` for the exchange log at `packages/e2e-test-runner/src/proxy-server.ts:315` through `packages/e2e-test-runner/src/proxy-server.ts:321`; any rejection reaches the catch handler and produces a `502` response. In the probe, capture logging rejects with `"capture disk full"`, the client receives `502`, and the existing snapshot has nevertheless been replaced with the newly fetched response `{ "id": "fresh" }`.

## Expected Behavior

A request reported as failed should not silently commit its record-mode snapshot update, or the proxy should clearly treat a successful snapshot write plus a failed auxiliary capture log as a successful proxied response with separately reported telemetry failure. Snapshot and capture outcomes should not leave clients unable to determine whether recording took effect.

## Impact

Automated recording workflows may retry a request after seeing status `502`, unaware that the first attempt already changed the playback fixture. A transient capture-log storage failure can therefore create hidden test-state mutations, duplicate upstream calls, and non-deterministic fixtures while the visible request outcome signals that no successful recording occurred.
