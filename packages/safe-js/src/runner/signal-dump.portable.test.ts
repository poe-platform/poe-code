import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { attachSignalDumpHandler } from "./signal-dump.js";

vi.mock("#safe-js-platform", async importOriginal => ({
  ...await importOriginal<typeof import("#safe-js-platform")>(),
  hostFs: new Proxy({}, { get() { throw new Error("No ambient filesystem"); } })
}));

afterEach(() => vi.unstubAllGlobals());

it("supports callback-only snapshots without ambient process or filesystem", async () => {
  const signals = new EventEmitter();
  const snapshots: string[] = [];
  vi.stubGlobal("process", undefined);
  let cleanup: (() => void) | undefined;
  try {
    cleanup = attachSignalDumpHandler(new Promise(() => {}), {
      process: signals,
      dumpResult: async () => "checkpoint",
      onSnapshot: snapshot => { snapshots.push(snapshot); }
    });
  } finally { vi.unstubAllGlobals(); }
  try {
    signals.emit("SIGUSR1");
    await Promise.resolve();
    expect(snapshots).toEqual(["checkpoint"]);
  } finally { cleanup?.(); }
  expect(signals.listenerCount("SIGUSR1")).toBe(0);
});

it("requires an explicit signal source when no process exists", () => {
  vi.stubGlobal("process", undefined);
  let failure: unknown;
  try { attachSignalDumpHandler(new Promise(() => {})); }
  catch (error) { failure = error; }
  finally { vi.unstubAllGlobals(); }
  expect(failure).toBeInstanceOf(TypeError);
  expect((failure as Error).message).toContain("signal source");
});

it("reports snapshot failures through console when no stderr is available", async () => {
  const signals = new EventEmitter();
  let reported!: () => void;
  const logged = new Promise<void>(resolve => { reported = resolve; });
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => reported());
  let cleanup: (() => void) | undefined;
  try {
    vi.stubGlobal("process", undefined);
    try {
      cleanup = attachSignalDumpHandler(new Promise(() => {}), {
        process: signals,
        dumpResult: async () => { throw new Error("snapshot unavailable"); }
      });
    } finally { vi.unstubAllGlobals(); }
    signals.emit("SIGUSR1");
    await logged;
    expect(errorLog).toHaveBeenCalledExactlyOnceWith("Failed to write SIGUSR1 dump to <memory>: snapshot unavailable");
  } finally {
    cleanup?.();
    errorLog.mockRestore();
  }
});
