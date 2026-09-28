import { expect, test, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand } from "./index.js";

test("imagemagick yields and cancels under a frozen workerd clock", async () => {
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  const now = Object.getOwnPropertyDescriptor(performance, "now");
  Reflect.deleteProperty(globalThis, "setImmediate");
  Object.defineProperty(performance, "now", { value: () => 0, configurable: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timer cancellation")), 0);
  try {
    let chunks = 0;
    await expect(createMagickCommand().execute({
      command: "imagemagick", args: createCommandArguments(["in", "out"]).args, cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: controller.signal,
      stdin: (async function* () { for (let i = 0; i < 10000; i++) { chunks++; yield new Uint8Array(); } })(),
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    })).rejects.toThrow("timer cancellation");
    expect(chunks).toBeLessThan(10000);
  } finally {
    clearTimeout(timer);
    if (immediate) Object.defineProperty(globalThis, "setImmediate", immediate);
    if (now) Object.defineProperty(performance, "now", now); else Reflect.deleteProperty(performance, "now");
  }
});

import { runConvertCli } from "./index.js";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";

test("imagemagick CPU processing observes cancellation before publishing output", async () => {
  vi.stubGlobal("setImmediate", undefined);
  vi.spyOn(performance, "now").mockReturnValue(0);
  const controller = new AbortController();
  const reason = new Error("cancel CPU processing");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    const doc = PdfDocument.create();
    doc.addPage([20, 20]).drawText("hello", { x: 1, y: 1, size: 5 });
    const bytes = encodePng({ width: 2, height: 2, data: new Uint8Array(16) });
    const files = new Map([["in", bytes]]);
    const outcome = await runConvertCli(["in", "-negate", "out.png"], files, undefined, controller.signal).catch(error => { expect(error).toBe(reason); return { exitCode: 1 }; });
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.exitCode).not.toBe(0);
    expect(files.size).toBe(1);
  } finally { clearTimeout(timer); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});

test("pixel transforms yield during work and stop before encoding output", async () => {
  vi.stubGlobal("setImmediate", undefined);
  vi.spyOn(performance, "now").mockReturnValue(0);
  const controller = new AbortController();
  const timer = globalThis.setTimeout;
  let turns = 0;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number) => timer(() => {
    if (++turns === 3) controller.abort(new Error("cancel pixel transform"));
    callback();
  }, ms)) as typeof setTimeout);
  try {
    const files = new Map([["in", encodePng({ width: 256, height: 256, data: new Uint8Array(256 * 256 * 4) })]]);
    const result = await runConvertCli(["in", "-evaluate", "Add", "1", "out.png"], files, undefined, controller.signal);
    expect(turns).toBeGreaterThanOrEqual(3);
    expect(result.exitCode).toBe(1);
    expect(files.has("out.png")).toBe(false);
  } finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
