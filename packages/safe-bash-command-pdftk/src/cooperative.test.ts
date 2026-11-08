import { expect, test, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand } from "./index.js";

test("pdftk yields and cancels under a frozen workerd clock", async () => {
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  const now = Object.getOwnPropertyDescriptor(performance, "now");
  Reflect.deleteProperty(globalThis, "setImmediate");
  Object.defineProperty(performance, "now", { value: () => 0, configurable: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timer cancellation")), 0);
  try {
    let chunks = 0;
    await expect(createPdftkCommand().execute({
      command: "pdftk", args: createCommandArguments(["-"]).args, cwd: "/", env: {},
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

import { runPdftkCli } from "./index.js";
import { PdfDocument } from "@poe-code/pdf-ast";

test("pdftk CPU processing observes cancellation before publishing output", async () => {
  vi.stubGlobal("setImmediate", undefined);
  vi.spyOn(performance, "now").mockReturnValue(0);
  const controller = new AbortController();
  const reason = new Error("cancel CPU processing");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    const doc = PdfDocument.create();
    doc.addPage([20, 20]).drawText("hello", { x: 1, y: 1, size: 5 });
    const bytes = doc.save();
    const files = new Map([["in", bytes]]);
    const outcome = await runPdftkCli(["in", "cat", "output", "out"], files, controller.signal).catch(error => { expect(error).toBe(reason); return { exitCode: 1 }; });
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.exitCode).not.toBe(0);
    expect(files.size).toBe(1);
  } finally { clearTimeout(timer); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
