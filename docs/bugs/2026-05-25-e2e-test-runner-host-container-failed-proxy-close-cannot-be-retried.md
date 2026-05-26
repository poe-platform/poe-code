# E2E test runner host container failed proxy close cannot be retried

## Summary

The host/environment container backend clears its tracked snapshot proxy reference before awaiting `proxy.close()`. If proxy shutdown rejects transiently, `destroy()` rejects once, but a second `destroy()` no longer attempts to close the still-owned proxy and proceeds as if that cleanup had succeeded.

## Reproduction

Create the disposable probe `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => (await import("memfs")).fs.promises);
vi.mock("node:os", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:os")>()), tmpdir: vi.fn(() => "/tmp") }));
vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("./credentials.js", () => ({ getApiKey: vi.fn(async () => "test-key") }));
vi.mock("./runtime.js", () => ({ getWorkspaceDir: vi.fn(() => "/workspace") }));
vi.mock("./proxy-server.js", () => ({ startProxyServer: vi.fn() }));

import { vol } from "memfs";
import { spawn, spawnSync } from "node:child_process";
import { startProxyServer } from "./proxy-server.js";
import { createEnvContainer } from "./env-container.js";

describe("host container failed proxy close retry", () => {
  it("forgets a proxy after its first shutdown attempt rejects", async () => {
    vol.mkdirSync("/tmp", { recursive: true });
    vol.mkdirSync("/workspace/node_modules/.bin", { recursive: true });
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "ok", stderr: "" } as never);
    vi.mocked(spawn).mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough };
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setTimeout(() => child.emit("close", 0), 0);
      return child as never;
    });
    const close = vi.fn().mockRejectedValueOnce(new Error("proxy close failed")).mockResolvedValueOnce(undefined);
    vi.mocked(startProxyServer).mockResolvedValue({ url: "http://proxy", close });
    const container = await createEnvContainer({ testName: "case", useSnapshots: true });
    await container.exec("echo ready");

    await expect(container.destroy()).rejects.toThrow("proxy close failed");
    await expect(container.destroy()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > host container failed proxy close retry > forgets a proxy after its first shutdown attempt rejects
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

After a command starts the optional snapshot proxy, `destroy()` captures `proxyState.server`, immediately replaces state with `server: null` and `log: null`, and only then awaits `server.close()` at `packages/e2e-test-runner/src/host-container.ts:398` through `packages/e2e-test-runner/src/host-container.ts:408`. In the probe, the first proxy close rejects with `proxy close failed` and would succeed on retry. Because the reference was already removed, the second `destroy()` does not invoke proxy shutdown again and resolves after deleting the temporary home directory; the proxy close spy is called only once.

## Expected Behavior

A proxy whose close attempt failed should remain tracked for a subsequent `destroy()` retry, or the container should ensure shutdown succeeds before forgetting ownership. An initial rejected destruction must not make later calls skip potentially live proxy teardown.

## Impact

Snapshot-enabled host or sandbox E2E containers can leak HTTP proxy servers and bound ports after a transient close failure. Subsequent cleanup appears successful while a proxy capable of forwarding or serving recorded requests may remain reachable, causing test interference and local resource leakage.
