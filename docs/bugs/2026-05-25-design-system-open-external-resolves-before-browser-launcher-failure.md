# Design system openExternal resolves before browser launcher failure

## Summary

The exported `@poe-code/design-system` `openExternal()` helper reports success as soon as the platform browser launcher process starts, without observing whether that launcher immediately exits unsuccessfully. A launcher such as `xdg-open` can therefore fail to open the URL while the API resolves and consumers display a successful-open notification.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/__probe__.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { openExternal } from "./components/browser.js";

describe("openExternal launcher process failures", () => {
  it("resolves after spawn even when the browser launcher immediately fails", async () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();

    const opened = openExternal("https://example.test/task", {
      platform: "linux",
      spawnProcess: () => child,
    });

    child.emit("spawn");
    child.emit("close", 3, null);

    await expect(opened).resolves.toBeUndefined();
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
```

Run the targeted probe, then remove it:

```sh
npm exec -- vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
rm -f packages/design-system/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/design-system/src/__probe__.test.ts > openExternal launcher process failures > resolves after spawn even when the browser launcher immediately fails
```

## Observed Behavior

`openExternal()` delegates to `launchBrowser()` in `packages/design-system/src/components/browser.ts:21`. The launcher installs handlers only for process-level `error` and the initial `spawn` event, then calls `child.unref()` and resolves immediately from the `spawn` handler at `packages/design-system/src/components/browser.ts:44`. It neither includes a `close`/`exit` event in its process interface nor observes a nonzero launcher status after successful process creation. In the reproduction, the launcher emits `spawn` and then exits with status `3`, but the returned promise still resolves.

The issue is user-visible through `packages/maestro-tui/src/actions.ts:111`, whose open-issue action awaits `openExternal(url)` and then toasts `Opened ...` at `packages/maestro-tui/src/actions.ts:128`. A browser launcher that starts but immediately fails is therefore displayed as a successful open action.

## Expected Behavior

Opening an external URL should not resolve as successful when the selected operating-system launcher terminates with an immediate failure before completing its launch handoff. The helper should observe an actionable launcher failure or avoid showing success when it cannot determine that opening occurred.

## Impact

Users can receive a positive confirmation that an issue or external resource was opened when no browser actually launched. Missing desktop integration, invalid opener configuration, or launcher runtime failures become silent UI misinformation, causing missed links and confusing workflow navigation rather than an actionable error.
