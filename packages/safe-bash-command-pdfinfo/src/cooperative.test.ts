import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdfinfoCommand } from "./index.js";

test("pdfinfo yields and cancels under a frozen workerd clock", async t => {
  const immediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  const now = Object.getOwnPropertyDescriptor(performance, "now");
  Reflect.deleteProperty(globalThis, "setImmediate");
  Object.defineProperty(performance, "now", { value: () => 0, configurable: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timer cancellation")), 0);
  try {
    let chunks = 0;
    await assert.rejects(async () => await createPdfinfoCommand().execute({
      command: "pdfinfo", args: createCommandArguments(["-"]).args, cwd: "/", env: {},
      fs: createMemoryFileSystem(), signal: controller.signal,
      stdin: (async function* () { for (let i = 0; i < 10000; i++) { chunks++; yield new Uint8Array(); } })(),
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }), /timer cancellation/);
    assert.ok(chunks < 10000);
  } finally {
    clearTimeout(timer);
    if (immediate) Object.defineProperty(globalThis, "setImmediate", immediate);
    if (now) Object.defineProperty(performance, "now", now); else Reflect.deleteProperty(performance, "now");
  }
});

import { runPdfinfoCli } from "./index.js";
import { PdfDocument } from "@poe-code/pdf-ast";

test("pdfinfo CPU processing observes cancellation before publishing output", async t => {
  const immediateDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
  Reflect.deleteProperty(globalThis, "setImmediate");
  t.mock.method(performance, "now", () => 0);
  const controller = new AbortController();
  const reason = new Error("cancel CPU processing");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    const doc = PdfDocument.create();
    doc.addPage([20, 20]).drawText("hello", { x: 1, y: 1, size: 5 });
    const bytes = doc.save();
    const files = new Map([["in", bytes]]);
    const outcome = await runPdfinfoCli(["in"], files, undefined, controller.signal).catch(error => { assert.equal(error, reason); return { exitCode: 1 }; });
    assert.equal(controller.signal.aborted, true);
    assert.notEqual(outcome.exitCode, 0);
    assert.equal(files.size, 1);
  } finally { clearTimeout(timer); if (immediateDescriptor) Object.defineProperty(globalThis, "setImmediate", immediateDescriptor); }
});
