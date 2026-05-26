# E2E Proxy Record Failed Snapshot Write Corrupts Prior Playback Fixture

## Summary

The `@poe-code/e2e-test-runner` proxy server records deterministic response snapshots by overwriting the active fixture for a request key. If record-mode persistence partially modifies an existing fixture before rejecting, the proxy returns an error and destroys the previously valid playback response.

## Reproduction

Create a disposable Vitest probe at `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { createHash } from "node:crypto";
import http, { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

let failedSnapshotPath: string | undefined;

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async writeFile(path: Parameters<typeof fs.promises.writeFile>[0], data: Parameters<typeof fs.promises.writeFile>[1], options?: Parameters<typeof fs.promises.writeFile>[2]) {
      if (path === failedSnapshotPath) {
        await fs.promises.writeFile(path, "{", options);
        throw new Error("snapshot disk full");
      }
      await fs.promises.writeFile(path, data, options);
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

describe("proxy interrupted snapshot replacement", () => {
  it("destroys a prior playback fixture when record-mode persistence rejects", async () => {
    vol.reset();
    const snapshotDir = "/tmp/proxy-snapshots";
    const payload = { model: "claude", messages: [{ role: "user", content: "same prompt" }] };
    const snapshotPath = join(snapshotDir, `${snapshotKey(payload)}.json`);
    vol.fromJSON({
      [snapshotPath]: JSON.stringify({ key: snapshotKey(payload), response: { id: "prior" } })
    });
    failedSnapshotPath = snapshotPath;
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ id: "fresh" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ id: "fresh" }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("missing upstream address");
    }
    const proxy = await startProxyServer({
      port: 0,
      captureFile: "/tmp/proxy-capture.jsonl",
      onMiss: "error",
      routes: [{ path: "/v1", target: `http://127.0.0.1:${address.port}`, mode: "record", snapshotDir }]
    });

    try {
      const response = await networkFetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      expect(response.status).toBe(502);
      const raw = vol.readFileSync(snapshotPath, "utf8") as string;
      console.log(JSON.stringify({ raw }));
      expect(raw).toBe("{");
    } finally {
      await proxy.close();
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
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
{"raw":"{"}
✓ packages/e2e-test-runner/src/__probe__.test.ts > proxy interrupted snapshot replacement > destroys a prior playback fixture when record-mode persistence rejects
```

Remove the disposable probe after validation.

## Observed Behavior

The proxy derives a deterministic fixture path and constructs a replacement snapshot in `packages/e2e-test-runner/src/proxy-server.ts:109` through `packages/e2e-test-runner/src/proxy-server.ts:132`, then directly overwrites that active fixture through `writeFile()` at `packages/e2e-test-runner/src/proxy-server.ts:133`. Record-mode requests await this write before returning their upstream result at `packages/e2e-test-runner/src/proxy-server.ts:310` through `packages/e2e-test-runner/src/proxy-server.ts:324`. In the probe, an existing valid snapshot is replaced with malformed JSON `"{"`, while the proxy responds with status `502` because the attempted replacement rejected.

## Expected Behavior

Recording or refreshing a deterministic snapshot should preserve the prior valid playback fixture if the new snapshot cannot be written completely. The proxy should commit fixture replacements atomically or retain the readable previous version after persistence failures.

## Impact

A transient storage interruption while updating a recorded E2E response can destroy a previously usable playback fixture. Subsequent deterministic test runs may fail to parse or replay the fixture, converting a failed snapshot refresh into durable loss of test data and unreliable offline playback.
