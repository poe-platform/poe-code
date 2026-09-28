import assert from "node:assert/strict";
import { test } from "node:test";
import { createPdfAstRenderer } from "./pdf-renderer.js";
import { parseInvocation } from "./parser.js";
import { wkhtmltopdfLimits } from "./command.js";

for (const cancel of [false, true]) {
  test(`HTML parsing/layout yields with a frozen clock (cancel=${cancel})`, async t => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
    Reflect.deleteProperty(globalThis, "setImmediate");
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, "setImmediate", descriptor); });
    t.mock.method(Date, "now", () => 0);
    t.mock.method(performance, "now", () => 0);
    const controller = new AbortController();
    const reason = new Error("cancel rendering");
    const timer = globalThis.setTimeout;
    let turns = 0;
    t.mock.method(globalThis, "setTimeout", ((callback: () => void, ms?: number) => timer(() => {
      turns++;
      if (cancel) controller.abort(reason);
      callback();
    }, ms)) as typeof setTimeout);
    const request = {
      job: parseInvocation(["input", "output"], {}),
      inputs: [new TextEncoder().encode("<p>text</p>".repeat(512))],
      signal: controller.signal,
      limits: wkhtmltopdfLimits,
    };
    if (cancel) await assert.rejects(createPdfAstRenderer().open(request), error => error === reason);
    else {
      const result = await createPdfAstRenderer().open(request);
      await result.close();
    }
    assert.ok(turns > 0, "processing must yield independently of elapsed time");
  });
}
