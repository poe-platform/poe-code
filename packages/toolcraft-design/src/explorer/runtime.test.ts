import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalBuffer } from "terminal-pilot";
import { FakeTerminalDriver } from "./runtime.test-helpers.js";
import type { ExplorerConfig, Row } from "./state.js";

const mockTerminal = vi.hoisted(() => ({
  driver: undefined as FakeTerminalDriver | undefined
}));

vi.mock("../dashboard/terminal.js", () => ({
  createTerminalDriver: () => {
    if (mockTerminal.driver === undefined) {
      throw new Error("FakeTerminalDriver was not configured");
    }
    return mockTerminal.driver;
  }
}));

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
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true
  });
  ({ runExplorer } = await import("./runtime.js"));
});

afterEach(() => {
  mockTerminal.driver = undefined;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: originalIsTTY
  });
  vi.restoreAllMocks();
});

describe("runExplorer", () => {
  it("runs and quits on q", async () => {
    const driver = currentDriver();
    const result = runExplorer(config());

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(key("q"));

    await expect(result).resolves.toBeNull();
    expect(driver.enterAltScreenCount).toBe(1);
    expect(driver.destroyed).toBe(true);
    expect(driver.altScreen).toBe(false);
  });

  it("selects a row and exits via the primary action", async () => {
    const driver = currentDriver();
    const selected: string[] = [];
    const result = runExplorer(
      config({
        actions: [
          {
            id: "open",
            label: "Open",
            primary: true,
            handler: (ctx) => {
              selected.push(ctx.row.id);
              ctx.exit();
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(namedKey("down"));
    driver.press(namedKey("return"));

    await expect(result).resolves.toBeNull();
    expect(selected).toEqual(["two"]);
  });

  it("repaints cursor movement before the next full redraw", async () => {
    const driver = currentDriver();
    const result = runExplorer(config());

    await waitFor(() => currentScreen(driver).some((line) => line.includes("● One")));
    driver.press(namedKey("down"));

    await waitFor(() => currentScreen(driver).some((line) => line.includes("● Two")));
    expect(currentScreen(driver).some((line) => line.includes("● One"))).toBe(false);

    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("runs a confirmed multi-select bulk action", async () => {
    const driver = currentDriver();
    const handledRows: string[][] = [];
    const result = runExplorer(
      config({
        multiSelect: true,
        actions: [
          {
            id: "delete",
            label: "Delete",
            key: "d",
            destructive: true,
            handler: (ctx) => {
              handledRows.push(ctx.rows.map((row) => row.id));
              ctx.exit();
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(key(" "));
    driver.press(namedKey("down"));
    driver.press(key(" "));
    driver.press(key("d"));
    await waitFor(() => strippedOutput(driver).includes("Confirm"));
    driver.press(key("y"));

    await expect(result).resolves.toBeNull();
    expect(handledRows).toEqual([["one", "two"]]);
  });

  it("keeps destructive actions single-row when multi-select is disabled", async () => {
    const driver = currentDriver();
    const handledRows: string[][] = [];
    const result = runExplorer(
      config({
        multiSelect: false,
        actions: [
          {
            id: "delete",
            label: "Delete",
            key: "d",
            destructive: true,
            handler: (ctx) => {
              handledRows.push(ctx.rows.map((row) => row.id));
              ctx.exit();
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(key(" "));
    driver.press(namedKey("down"));
    driver.press(key(" "));
    driver.press(key("d"));
    await waitFor(() => strippedOutput(driver).includes("Confirm"));
    expect(strippedOutput(driver)).not.toContain("selected");
    driver.press(key("y"));

    await expect(result).resolves.toBeNull();
    expect(handledRows).toEqual([["two"]]);
  });

  it("cancels stale async detail jobs when the cursor moves", async () => {
    const driver = currentDriver();
    let firstAborted = false;
    const result = runExplorer(
      config({
        detail: {
          items: async (row, ctx) => {
            if (row.id === "one") {
              return new Promise((resolve) => {
                ctx.signal.addEventListener("abort", () => {
                  firstAborted = true;
                  resolve([{ id: "stale", render: () => "detail one" }]);
                });
              });
            }

            return [{ id: row.id, render: () => `detail ${row.id}` }];
          }
        }
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(namedKey("down"));

    await waitFor(() => firstAborted);
    await waitFor(() => strippedOutput(driver).includes("detail two"));
    expect(currentScreen(driver).join("\n")).not.toContain("detail one");
    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("renders asynchronous detail content after it resolves", async () => {
    const driver = currentDriver();
    let resolveDetail: ((value: string) => void) | undefined;
    const result = runExplorer(
      config({
        detail: {
          items: async (row) => [
            {
              id: row.id,
              render: () =>
                new Promise<string>((resolve) => {
                  resolveDetail = resolve;
                })
            }
          ]
        }
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    await waitFor(() => resolveDetail !== undefined);
    resolveDetail!("Resolved async detail");
    await waitFor(() => currentScreen(driver).join("\n").includes("Resolved async detail"));

    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("persists reorder and rolls back on rejection", async () => {
    const driver = currentDriver();
    const onReorder = vi.fn(async () => {
      throw new Error("save failed");
    });
    const opened: string[] = [];
    const result = runExplorer(
      config({
        reorder: { onReorder },
        actions: [
          {
            id: "open",
            label: "Open",
            primary: true,
            handler: (ctx) => {
              opened.push(ctx.row.id);
              ctx.exit();
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press({ name: "down", ctrl: false, meta: false, shift: true });

    await waitFor(() => strippedOutput(driver).includes("save failed"));
    expect(onReorder).toHaveBeenCalledWith(["two", "one", "three"], {
      refresh: expect.any(Function),
      toast: expect.any(Function)
    });
    driver.press(namedKey("return"));

    await expect(result).resolves.toBeNull();
    expect(opened).toEqual(["two"]);
  });

  it("does not let an older failed reorder roll back a newer order", async () => {
    const driver = currentDriver();
    let rejectFirst: ((error: Error) => void) | undefined;
    const onReorder = vi.fn((orderedIds: string[]) => {
      if (orderedIds.join(",") === "two,one,three") {
        return new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve();
    });
    const result = runExplorer(config({ reorder: { onReorder } }));

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press({ name: "down", ctrl: false, meta: false, shift: true });
    driver.press({ name: "down", ctrl: false, meta: false, shift: true });
    await waitFor(() => onReorder.mock.calls.length === 2);
    rejectFirst!(new Error("save failed"));
    await waitFor(() => strippedOutput(driver).includes("save failed"));

    const screen = currentScreen(driver).join("\n");
    expect(screen.indexOf("Three")).toBeLessThan(screen.indexOf("One"));
    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("round-trips through suspendAnd", async () => {
    const driver = currentDriver();
    let suspended = false;
    const result = runExplorer(
      config({
        actions: [
          {
            id: "edit",
            label: "Edit",
            key: "e",
            handler: async (ctx) => {
              await ctx.suspendAnd(async () => {
                suspended = true;
                expect(driver.altScreen).toBe(false);
              });
              ctx.exit();
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(key("e"));

    await expect(result).resolves.toBeNull();
    expect(suspended).toBe(true);
    expect(driver.exitAltScreenCount).toBeGreaterThanOrEqual(1);
    expect(driver.enterAltScreenCount).toBeGreaterThanOrEqual(2);
  });

  it("does not handle explorer keypresses while suspended", async () => {
    const driver = currentDriver();
    let releaseSuspended: (() => void) | undefined;
    const handled: string[] = [];
    const result = runExplorer(
      config({
        actions: [
          {
            id: "nested",
            label: "Nested",
            key: "s",
            handler: async (ctx) => {
              await ctx.suspendAnd(async () => {
                await new Promise<void>((resolve) => {
                  releaseSuspended = resolve;
                });
              });
              ctx.exit();
            }
          },
          {
            id: "other",
            label: "Other",
            key: "o",
            handler: () => {
              handled.push("other");
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    driver.press(key("s"));
    await waitFor(() => releaseSuspended !== undefined);
    driver.press(key("o"));
    releaseSuspended?.();

    await expect(result).resolves.toBeNull();
    expect(handled).toEqual([]);
  });

  it("calls config refresh before reloading rows from an action refresh", async () => {
    const driver = currentDriver();
    let currentRows = rows;
    const loadRows = vi.fn(async () => currentRows);
    const refresh = vi.fn(async () => {
      currentRows = [{ id: "fresh", title: "Fresh" }];
    });
    const result = runExplorer(
      config({
        rows: loadRows,
        refresh,
        actions: [
          {
            id: "refresh",
            label: "Refresh",
            primary: true,
            handler: async (ctx) => {
              await ctx.refresh();
              ctx.exit();
            }
          }
        ]
      })
    );

    await waitFor(() => strippedOutput(driver).includes("One"));
    expect(refresh).not.toHaveBeenCalled();
    driver.press(namedKey("return"));

    await expect(result).resolves.toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    expect(loadRows).toHaveBeenCalledTimes(2);
  });

  it("ignores row refresh responses older than the latest request", async () => {
    const driver = currentDriver();
    const pending: Array<(nextRows: Row[]) => void> = [];
    let initial = true;
    const result = runExplorer(
      config({
        rows: async () =>
          initial
            ? ((initial = false), [{ id: "initial", title: "Initial" }])
            : new Promise<Row[]>((resolve) => pending.push(resolve)),
        actions: ["a", "b"].map((binding) => ({
          id: `reload-${binding}`,
          label: `reload-${binding}`,
          key: binding,
          handler: async (ctx) => ctx.refresh()
        }))
      })
    );

    await waitFor(() => strippedOutput(driver).includes("Initial"));
    driver.press(key("a"));
    driver.press(key("b"));
    await waitFor(() => pending.length === 2);
    pending[1]!([{ id: "fresh", title: "Fresh" }]);
    await waitFor(() => currentScreen(driver).join("\n").includes("Fresh"));
    pending[0]!([{ id: "stale", title: "Stale" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentScreen(driver).join("\n")).toContain("Fresh");
    expect(currentScreen(driver).join("\n")).not.toContain("Stale");
    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("rejects when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false
    });

    await expect(runExplorer(config())).rejects.toThrow("explorer requires a TTY");
  });
});

function config(overrides: Partial<ExplorerConfig<void>> = {}): ExplorerConfig<void> {
  return {
    title: "Plans",
    rows: async () => rows,
    detail: {
      items: async (row) => [{ id: row.id, render: () => `detail ${row.id}` }]
    },
    actions: [],
    ...overrides
  };
}

function currentDriver(): FakeTerminalDriver {
  if (mockTerminal.driver === undefined) {
    throw new Error("FakeTerminalDriver was not configured");
  }
  return mockTerminal.driver;
}

function key(ch: string) {
  return { ch, ctrl: false, meta: false, shift: false };
}

function namedKey(name: string) {
  return { name, ctrl: false, meta: false, shift: false };
}

function strippedOutput(driver: FakeTerminalDriver): string {
  return driver.output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function currentScreen(driver: FakeTerminalDriver): string[] {
  const terminal = new TerminalBuffer(driver.getSize().cols, driver.getSize().rows);
  terminal.write(driver.output);
  return Array.from({ length: driver.getSize().rows }, (_, row) => {
    const line = terminal.displayBuffer.data[row] ?? [];
    return Array.from(
      { length: driver.getSize().cols },
      (_, column) => line[column]?.[1] ?? " "
    ).join("");
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error("Timed out waiting for runtime condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
