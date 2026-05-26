# E2E test runner persistent container destroy reports success when removal fails

## Summary

The persistent-container backend exposes an asynchronous `destroy()` operation, but it ignores the exit status from its `podman rm -f` command. If Podman refuses to remove the container, `destroy()` still resolves successfully while the supposedly destroyed test environment remains present.

## Reproduction

Create the disposable probe `packages/e2e-test-runner/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => (await import("memfs")).fs);
vi.mock("node:child_process", () => ({ spawnSync: vi.fn(), spawn: vi.fn() }));
vi.mock("./engine.js", () => ({ detectEngine: vi.fn(() => "podman") }));
vi.mock("./credentials.js", () => ({ getApiKey: vi.fn(async () => null) }));

import { spawnSync } from "node:child_process";
import { createContainer } from "./persistent-container.js";

describe("persistent container failed destroy", () => {
  it("reports success even when podman refuses to remove the container", async () => {
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const operation = (args as string[])[0];
      if (operation === "create") return { status: 0, stdout: "container-id\n", stderr: "" } as never;
      if (operation === "start") return { status: 0, stdout: "", stderr: "" } as never;
      return { status: 1, stdout: "", stderr: "container still busy" } as never;
    });
    const container = await createContainer({ image: "poe-code-e2e:test" });

    await expect(container.destroy()).resolves.toBeUndefined();
    expect(vi.mocked(spawnSync)).toHaveBeenLastCalledWith(
      "podman", ["rm", "-f", "container-id"], { stdio: "ignore" }
    );
  });
});
```

Run:

```sh
npm exec -- vitest run packages/e2e-test-runner/src/__probe__.test.ts --reporter verbose
```

Result:

```text
✓ packages/e2e-test-runner/src/__probe__.test.ts > persistent container failed destroy > reports success even when podman refuses to remove the container
```

Delete the disposable probe after confirming the behavior.

## Observed Behavior

The `Container` contract exposes `destroy(): Promise<void>`, but the persistent implementation executes `spawnSync(engine, ["rm", "-f", containerId], { stdio: "ignore" })` and discards its result at `packages/e2e-test-runner/src/persistent-container.ts:367` through `packages/e2e-test-runner/src/persistent-container.ts:374`. In the probe, container creation and startup succeed, the remove command returns status `1` with `container still busy`, and `container.destroy()` nevertheless resolves without reporting failure.

## Expected Behavior

`destroy()` should verify the container-removal command result and reject when cleanup fails, or otherwise return an explicit incomplete-cleanup result. A successful resolved destruction promise should indicate that the persistent container was actually removed.

## Impact

E2E suites and cleanup hooks can leak live or stopped containers while reporting successful teardown. Accumulated containers consume local resources, retain test data or credentials, interfere with subsequent runs, and make CI or developer environments increasingly unreliable without any failure signal from the public destructor.
