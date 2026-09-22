import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

// Conditional bundles executed in isolated Node VM realms, not real browser/workerd QA.
for (const condition of ["node", "browser", "workerd"]) {
  test(`portable source-bundled ${condition} consumer has no external runtime imports`, async () => {
    const result = await build({
      absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
      stdin: {
        contents: `
          import * as engine from "./index.js";
          export { engine };
          const { parsePdfObjects, getPdfCommandGate, defaultPdfLimits } = engine;
          export function inspect() {
            const bytes = new Uint8Array([60, 48, 48, 102, 102, 62]);
            const object = parsePdfObjects(bytes)[0];
            const gate = getPdfCommandGate("qpdf");
            const controller = new AbortController(); controller.abort(false);
            let cancelled = false;
            try { getPdfCommandGate("pdfinfo", { signal: controller.signal }); }
            catch (error) { cancelled = error === false; }
            return { bytes: Array.from(object.bytes), raw: Array.from(object.raw),
              unchanged: Array.from(bytes), qualified: gate.qualified,
              lossless: gate.missing.includes("losslessRewriting"), cancelled,
              inputLimit: defaultPdfLimits.inputBytes };
          }
        `,
        resolveDir: fileURLToPath(new URL(".", import.meta.url)),
        sourcefile: "pdf-consumer.ts",
        loader: "ts"
      },
      bundle: true, write: false, metafile: true, platform: "neutral",
      conditions: [condition], format: "iife", globalName: "pdfConsumer"
    });
    for (const output of Object.values(result.metafile!.outputs))
      assert.deepEqual(output.imports, []);
    for (const input of Object.keys(result.metafile!.inputs)) {
      assert.ok(input === "pdf-consumer.ts" || input.startsWith("src/"), input);
      assert.ok(!input.endsWith("node-crypto.ts"), input);
    }
    const consumer = runInNewContext(result.outputFiles![0]!.text + ";pdfConsumer.inspect()", {
      AbortController
    }) as Record<string, unknown>;
    // JSON transports results across realms; no foreign constructor equality assumption.
    assert.deepEqual(JSON.parse(JSON.stringify(consumer)), {
      bytes: [0, 255], raw: [60, 48, 48, 102, 102, 62],
      unchanged: [60, 48, 48, 102, 102, 62], qualified: false,
      lossless: true, cancelled: true, inputLimit: 16 * 1024 * 1024
    });
  });
}
