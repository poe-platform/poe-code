# Design System explorer overlapping refreshes render stale row results

## Summary

`@poe-code/design-system` explorer permits independent actions to start concurrent `ctx.refresh()` calls without associating row responses with their request order. If a slower earlier refresh resolves after a newer refresh, its stale row set overwrites the fresh results already displayed to the user.

## Reproduction

Create a disposable Vitest probe at `packages/design-system/src/explorer/__probe__.test.ts` using the existing fake terminal harness from `packages/design-system/src/explorer/runtime.test-helpers.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalBuffer } from "../../../terminal-pilot/src/terminal-buffer.js";
import { FakeTerminalDriver } from "./runtime.test-helpers.js";
import type { ExplorerConfig, Row } from "./state.js";

const mockTerminal = vi.hoisted(() => ({ driver: undefined as FakeTerminalDriver | undefined }));

vi.mock("../dashboard/terminal.js", () => ({ createTerminalDriver: () => mockTerminal.driver! }));

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

describe("explorer overlapping refresh probe", () => {
  it("renders an older load after a newer refresh has completed", async () => {
    const pending: Array<(rows: Row[]) => void> = [];
    let initial = true;
    const refreshAction = (id: string, keyName: string) => ({
      id,
      label: id,
      key: keyName,
      handler: async (ctx: { refresh: () => Promise<void> }) => ctx.refresh()
    });
    const config: ExplorerConfig<void> = {
      title: "Probe",
      rows: async () => initial ? ((initial = false), [{ id: "initial", title: "Initial" }]) : new Promise<Row[]>((resolve) => pending.push(resolve)),
      detail: { items: async () => [] },
      actions: [refreshAction("reload-a", "a"), refreshAction("reload-b", "b")]
    };
    const driver = mockTerminal.driver!;
    const result = runExplorer(config);
    await waitFor(() => strippedOutput(driver).includes("Initial"));

    driver.press(key("a"));
    driver.press(key("b"));
    await waitFor(() => pending.length === 2);
    pending[1]!([{ id: "fresh", title: "Fresh" }]);
    await waitFor(() => currentScreen(driver).join("\n").includes("Fresh"));
    pending[0]!([{ id: "stale", title: "Stale" }]);
    await waitFor(() => currentScreen(driver).join("\n").includes("Stale"));

    expect(currentScreen(driver).join("\n")).not.toContain("Fresh");
    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });
});

function key(ch: string) { return { ch, ctrl: false, meta: false, shift: false }; }
function strippedOutput(driver: FakeTerminalDriver): string { return driver.output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, ""); }
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
✓ packages/design-system/src/explorer/__probe__.test.ts > explorer overlapping refresh probe > renders an older load after a newer refresh has completed
```

## Observed Behavior

After the second action refresh resolves with a visible `Fresh` row, resolving the first action's older load replaces the screen with `Stale`. `runtimeHandles.refresh()` calls `refreshRowsFromSource()` without serialization or request tokens at `packages/design-system/src/explorer/runtime.ts:55`, and `loadRows()` dispatches every resolved row response unconditionally at `packages/design-system/src/explorer/runtime.ts:101`. The reducer then replaces the current row state on every `rowsLoaded` event at `packages/design-system/src/explorer/reducer.ts:237`.

## Expected Behavior

When row refresh requests overlap, the explorer should apply only the latest relevant response, cancel obsolete requests, or otherwise prevent an earlier result from replacing a newer view. Completion order must not make displayed state regress to stale data.

## Impact

Interactive actions that independently call `ctx.refresh()` can leave the explorer displaying outdated rows after a user has already seen newer data. Users may then act on entries that were removed or changed by the fresh response, miss newly available rows, or assume a completed update reverted when the UI merely accepted an out-of-order result.
