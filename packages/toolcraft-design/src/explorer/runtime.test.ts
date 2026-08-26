import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalBuffer } from "terminal-pilot";
import { parseKeypress } from "../dashboard/terminal.js";
import { FakeTerminalDriver } from "./runtime.test-helpers.js";
import type { ExplorerConfig, Row } from "./state.js";

const mockTerminal = vi.hoisted(() => ({ driver: undefined as FakeTerminalDriver | undefined }));
vi.mock("../terminal/driver.js", () => ({ createTerminalDriver: () => mockTerminal.driver! }));
const rows: Row[] = [{ id: "one", title: "One" }, { id: "two", title: "Two" }];
const originalIsTTY = process.stdout.isTTY;
let runExplorer: typeof import("./runtime.js").runExplorer;

beforeEach(async () => {
  vi.resetModules();
  mockTerminal.driver = new FakeTerminalDriver();
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  ({ runExplorer } = await import("./runtime.js"));
});
afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsTTY });
  vi.restoreAllMocks();
});

describe("runExplorer", () => {
  it("paints immediately, coalesces navigation, and Ctrl+C quits", async () => {
    const result = runExplorer(config());
    await waitFor(() => screen().includes("One"));
    driver().press(named("down"));
    await waitFor(() => screen().includes("● Two"));
    driver().press(ctrl("c"));
    await expect(result).resolves.toBeNull();
    expect(driver().startCount).toBe(1);
    expect(driver().stopCount).toBe(1);
  });

  it("exits an open palette on one parsed Ctrl+C", async () => {
    const settled = vi.fn();
    const result = runExplorer(config()).then((value) => {
      settled(value);
      return value;
    });
    try {
      await waitFor(() => screen().includes("One"));
      const palette = parseKeypress(Buffer.from("\u0010"));
      const quit = parseKeypress(Buffer.from("\u0003"));
      expect(palette).toBeDefined();
      expect(quit).toBeDefined();
      driver().press(palette!);
      await waitFor(() => screen().includes("Command Palette"));

      driver().press(quit!);
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(driver().stopCount).toBe(1);
      expect(settled).toHaveBeenCalledExactlyOnceWith(null);
      await expect(result).resolves.toBeNull();
      expect(driver().startCount).toBe(1);
    } finally {
      if (driver().started) {
        driver().press(named("escape"));
        driver().press(ctrl("c"));
      }
    }
  });

  it.each(["input", "confirm"])(
    "cancels an awaited %s and waits for cleanup on one Ctrl+C",
    async (modal) => {
      const response = vi.fn();
      const completed = vi.fn();
      const settled = vi.fn();
      let releaseCleanup!: () => void;
      const cleanup = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      const result = runExplorer(
        config({
          actions: [
            {
              id: "prompt",
              label: "Prompt",
              accelerator: "e",
              handler: async (ctx) => {
                response(
                  modal === "input"
                    ? await ctx.promptText({
                        title: "Pending input",
                        label: "Name",
                        initialValue: "draft"
                      })
                    : await ctx.confirm({
                        title: "Pending confirm",
                        message: "Continue?",
                        destructive: true
                      })
                );
                await cleanup;
                completed();
              }
            }
          ]
        })
      ).then((value) => {
        settled(value);
        return value;
      });
      try {
        await waitFor(() => screen().includes("One"));
        driver().press(ctrl("e"));
        await waitFor(() => screen().includes(`Pending ${modal}`));
        const quit = parseKeypress(Buffer.from("\u0003"));
        expect(quit).toBeDefined();

        driver().press(quit!);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(response).toHaveBeenCalledExactlyOnceWith(modal === "input" ? null : false);
        expect(driver().stopCount).toBe(1);
        expect(completed).not.toHaveBeenCalled();
        expect(settled).not.toHaveBeenCalled();

        releaseCleanup();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completed).toHaveBeenCalledTimes(1);
        expect(settled).toHaveBeenCalledExactlyOnceWith(null);
        await expect(result).resolves.toBeNull();
        expect(driver().startCount).toBe(1);
        expect(driver().stopCount).toBe(1);
      } finally {
        releaseCleanup();
        if (driver().started) {
          driver().press(named("escape"));
          driver().press(ctrl("c"));
        }
      }
    }
  );

  it("treats every printable character as filter input", async () => {
    const handler = vi.fn();
    const result = runExplorer(config({ actions: [{ id: "edit", label: "Edit", accelerator: "e", handler }] }));
    await waitFor(() => screen().includes("One"));
    for (const ch of "read") driver().press(printable(ch));
    await waitFor(() => screen().includes("read"));
    expect(handler).not.toHaveBeenCalled();
    driver().press(ctrl("c"));
    await result;
  });

  it("aborts stale detail work and displays the latest result", async () => {
    let aborted = false;
    const result = runExplorer(config({ detail: { items: async (row, ctx) => {
      if (row.id === "one") return new Promise(resolve => ctx.signal.addEventListener("abort", () => { aborted = true; resolve([]); }, { once: true }));
      return [{ id: "two", render: () => "latest detail" }];
    } } }));
    await waitFor(() => screen().includes("One"));
    driver().press(named("down"));
    await waitFor(() => aborted);
    await waitFor(() => screen().includes("latest detail"));
    driver().press(ctrl("c"));
    await result;
  });

  it("confirms destructive Ctrl actions and waits for the action before exit", async () => {
    const handled: string[] = [];
    const result = runExplorer(config({ actions: [{ id: "remove", label: "Remove", accelerator: "x", destructive: true, handler: async ctx => { await Promise.resolve(); handled.push(ctx.row.id); ctx.exit(); } }] }));
    await waitFor(() => screen().includes("One"));
    driver().press(ctrl("x"));
    await waitFor(() => screen().includes("Confirm"));
    driver().press(named("enter"));
    await expect(result).resolves.toBeNull();
    expect(handled).toEqual(["one"]);
  });

  it("suppresses frames and input while suspended, then restores the terminal", async () => {
    let resume!: () => void;
    const editor = new Promise<void>(resolve => { resume = resolve; });
    const result = runExplorer(config({ actions: [{ id: "edit", label: "Edit", accelerator: "e", handler: async ctx => { await ctx.suspendAnd(() => editor); ctx.exit(); } }] }));
    await waitFor(() => screen().includes("One"));
    driver().press(ctrl("e"));
    await waitFor(() => !driver().started);
    const writes = driver().writes.length;
    driver().press(printable("x"));
    expect(driver().writes.length).toBe(writes);
    resume();
    await expect(result).resolves.toBeNull();
    expect(driver().startCount).toBe(2);
  });

  it("rejects without a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    await expect(runExplorer(config())).rejects.toThrow("explorer requires a TTY");
  });
});

function config(overrides: Partial<ExplorerConfig<void>> = {}): ExplorerConfig<void> {
  return { title: "Plans", rows: async () => rows, detail: { items: async row => [{ id: row.id, render: () => `detail ${row.id}` }] }, actions: [], ...overrides };
}
function driver(): FakeTerminalDriver { return mockTerminal.driver!; }
function printable(ch: string) { return { ch, ctrl: false, meta: false, shift: false }; }
function named(name: string) { return { name, ctrl: false, meta: false, shift: false }; }
function ctrl(ch: string) { return { ch, name: ch, ctrl: true, meta: false, shift: false }; }
function screen(): string {
  const size = driver().getSize();
  const terminal = new TerminalBuffer(size.cols, size.rows);
  terminal.write(driver().output);
  return terminal.displayBuffer.data.map(line => line.map(cell => cell?.[1] ?? " ").join("")).join("\n");
}
async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error("Timed out waiting for runtime condition");
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
