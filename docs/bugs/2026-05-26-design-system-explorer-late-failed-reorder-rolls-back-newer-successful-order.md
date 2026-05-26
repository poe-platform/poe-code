# Design System explorer late failed reorder rolls back newer successful order

## Summary

`@poe-code/design-system` explorer runs optimistic reorder persistence operations concurrently and rolls each failure back to the row ordering captured before that individual move. If an earlier persistence request rejects after a later reorder has already succeeded, the older failure restores obsolete rows and erases the newer successful ordering from the UI.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts` using the existing fake terminal harness from `packages/design-system/src/explorer/runtime.test-helpers.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalBuffer } from "../../../terminal-pilot/src/terminal-buffer.js";
import { FakeTerminalDriver } from "./runtime.test-helpers.js";
import type { ExplorerConfig, Row } from "./state.js";

const mockTerminal = vi.hoisted(() => ({ driver: undefined as FakeTerminalDriver | undefined }));
vi.mock("../dashboard/terminal.js", () => ({ createTerminalDriver: () => mockTerminal.driver! }));

const rows: Row[] = [
  { id: "one", title: "One" },
  { id: "two", title: "Two" },
  { id: "three", title: "Three" }
];
const originalIsTTY = process.stdout.isTTY;
let runExplorer: typeof import("./runtime.js").runExplorer;

beforeEach(async () => {
  vi.resetModules();
  mockTerminal.driver = new FakeTerminalDriver();
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  ({ runExplorer } = await import("./runtime.js"));
});

afterEach(() => {
  mockTerminal.driver = undefined;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsTTY });
  vi.restoreAllMocks();
});

describe("explorer overlapping reorder probe", () => {
  it("rolls back a newer successful order when an older persist later fails", async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    let call = 0;
    const onReorder = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
      }
    });
    const config: ExplorerConfig<void> = {
      title: "Probe",
      rows: async () => rows,
      detail: { items: async () => [] },
      actions: [],
      reorder: { onReorder }
    };
    const driver = mockTerminal.driver!;
    const result = runExplorer(config);
    await waitFor(() => currentScreen(driver).join("\n").includes("One"));

    driver.press({ name: "down", ctrl: false, meta: false, shift: true });
    driver.press({ name: "down", ctrl: false, meta: false, shift: true });
    await waitFor(() => onReorder.mock.calls.length === 2);
    expect(currentScreen(driver).join("\n")).toMatch(/Two[\s\S]*Three[\s\S]*One/);

    rejectFirst!(new Error("old persist failed"));
    await waitFor(() => currentScreen(driver).join("\n").includes("old persist failed"));
    expect(currentScreen(driver).join("\n")).toMatch(/One[\s\S]*Two[\s\S]*Three/);

    driver.press({ ch: "q", ctrl: false, meta: false, shift: false });
    await expect(result).resolves.toBeNull();
  });
});

function currentScreen(driver: FakeTerminalDriver): string[] {
  const terminal = new TerminalBuffer(driver.getSize().cols, driver.getSize().rows);
  terminal.write(driver.output);
  return Array.from({ length: driver.getSize().rows }, (_, row) => {
    const line = terminal.displayBuffer.data[row] ?? [];
    return Array.from({ length: driver.getSize().cols }, (_, column) => line[column]?.[1] ?? " ").join("");
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error("Timed out waiting for runtime condition");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/design-system/src/explorer/__probe__.test.ts --reporter verbose
rm packages/design-system/src/explorer/__probe__.test.ts
```

Observed test output:

```text
✓ packages/design-system/src/explorer/__probe__.test.ts > explorer overlapping reorder probe > rolls back a newer successful order when an older persist later fails
```

## Observed Behavior

Two reorder keystrokes optimistically render the newer order `Two, Three, One`, and the second `onReorder()` call completes successfully. When the still-pending first `onReorder()` call then rejects, the explorer replaces the visible order with the original `One, Two, Three`. Each reorder emits its own `persistOrder` effect at `packages/design-system/src/explorer/reducer.ts:583`; `applyEffects()` invokes persistence independently with the preceding rows at `packages/design-system/src/explorer/runtime.ts:123`; and any rejection unconditionally dispatches those captured prior rows as rollback at `packages/design-system/src/explorer/runtime.ts:166`.

## Expected Behavior

Reorder persistence should be serialized, versioned, or reconciled so a failure from an obsolete earlier operation cannot overwrite the visible result of a later successfully persisted reorder. Rollback must apply only while the failed request still owns the current optimistic state.

## Impact

Rapid interactive reordering can leave the UI showing an order older than the last successful backend update. Users may see a false rollback, repeat movements unnecessarily, or issue follow-up operations against an ordering that no longer matches persisted state, creating further conflicts and mistrust in the explorer view.
