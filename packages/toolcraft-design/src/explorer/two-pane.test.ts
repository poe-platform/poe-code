import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalBuffer } from "terminal-pilot";
import { FakeTerminalDriver } from "./runtime.test-helpers.js";
import type { TwoPaneExplorerConfig, TwoPaneRow } from "./two-pane.js";

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

const leftRows: TwoPaneRow[] = [
  { id: "left-one", title: "Left One", subtitle: "skill" },
  { id: "left-two", title: "Left Two", subtitle: "hook" }
];

const rightRows: TwoPaneRow[] = [
  { id: "right-one", title: "Right One", subtitle: "skill" },
  { id: "right-two", title: "Right Two", subtitle: "hook" }
];

const originalIsTTY = process.stdout.isTTY;
let runTwoPaneExplorer: typeof import("./two-pane.js").runTwoPaneExplorer;

beforeEach(async () => {
  vi.resetModules();
  mockTerminal.driver = new FakeTerminalDriver();
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true
  });
  ({ runTwoPaneExplorer } = await import("./two-pane.js"));
});

afterEach(() => {
  mockTerminal.driver = undefined;
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: originalIsTTY
  });
  vi.restoreAllMocks();
});

describe("runTwoPaneExplorer", () => {
  it("renders two panes and quits on q", async () => {
    const driver = currentDriver();
    const result = runTwoPaneExplorer(config());

    await waitFor(() => currentScreen(driver).join("\n").includes("Left One"));
    const screen = currentScreen(driver).join("\n");
    expect(screen).toContain("Project");
    expect(screen).toContain("Gist");
    expect(screen).toContain("Right One");

    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
    expect(driver.enterAltScreenCount).toBe(1);
    expect(driver.destroyed).toBe(true);
  });

  it("switches panes and sends selected active-pane rows to actions", async () => {
    const driver = currentDriver();
    const handled: Array<{ active: string; inactive: string; rows: string[] }> = [];
    const result = runTwoPaneExplorer(config({
      actions: [{
        id: "copy",
        label: "Copy",
        key: "c",
        handler: (ctx) => {
          handled.push({
            active: ctx.activePane.id,
            inactive: ctx.inactivePane.id,
            rows: ctx.rows.map((row) => row.id)
          });
          ctx.exit();
        }
      }]
    }));

    await waitFor(() => currentScreen(driver).join("\n").includes("Left One"));
    driver.press(namedKey("tab"));
    driver.press(namedKey("down"));
    driver.press(key(" "));
    driver.press(key("c"));

    await expect(result).resolves.toBeNull();
    expect(handled).toEqual([{ active: "right", inactive: "left", rows: ["right-two"] }]);
  });

  it("filters only the active pane", async () => {
    const driver = currentDriver();
    const result = runTwoPaneExplorer(config());

    await waitFor(() => currentScreen(driver).join("\n").includes("Left One"));
    driver.press(key("/"));
    driver.press(key("t"));
    driver.press(key("w"));
    driver.press(key("o"));
    driver.press(namedKey("return"));

    await waitFor(() => currentScreen(driver).join("\n").includes("Left Two"));
    const screen = currentScreen(driver).join("\n");
    expect(screen).not.toContain("Left One");
    expect(screen).toContain("Right One");

    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("clears empty hints after pane rows load", async () => {
    const driver = currentDriver();
    let resolveRightRows: ((rows: TwoPaneRow[]) => void) | undefined;
    const result = runTwoPaneExplorer(config({
      panes: [
        {
          id: "left",
          title: "Project",
          emptyHint: "No items in left pane",
          rows: async () => []
        },
        {
          id: "right",
          title: "Gist",
          emptyHint: "No items in right pane",
          rows: () => new Promise<TwoPaneRow[]>((resolve) => {
            resolveRightRows = resolve;
          })
        }
      ]
    }));

    await waitFor(() => currentScreen(driver).join("\n").includes("No items in right pane"));
    await waitFor(() => resolveRightRows !== undefined);
    resolveRightRows([{ id: "right-one", title: "Right One" }]);

    await waitFor(() => currentScreen(driver).join("\n").includes("Right One"));
    expect(currentScreen(driver).join("\n")).not.toContain("No items in right pane");

    driver.press(key("q"));
    await expect(result).resolves.toBeNull();
  });

  it("rejects when stdout is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false
    });

    await expect(runTwoPaneExplorer(config())).rejects.toThrow("two-pane explorer requires a TTY");
  });
});

function config(
  overrides: Partial<TwoPaneExplorerConfig<void>> = {}
): TwoPaneExplorerConfig<void> {
  return {
    title: "agent-stash browse",
    panes: [
      { id: "left", title: "Project", rows: async () => leftRows },
      { id: "right", title: "Gist", rows: async () => rightRows }
    ],
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
