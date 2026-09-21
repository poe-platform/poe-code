import { expect, it } from "vitest";
import { createEngine } from "../engine.js";
import type { Codec } from "../codecs.js";
import type { Diagnostic } from "../contracts.js";

it("awaits negative Bessel K diagnostics in formula order before publishing bytes", async () => {
  const events: string[] = [], warnings: Diagnostic[] = [];
  const codec: Codec = { id: "original", description: "Original numeric diagnostic fixture", extensions: ["original"], probeContent: () => true,
    async read() { return { sheets: [{ id: "s", name: "Sheet", cells: ["=BESSELK(-1,0)", "=BESSELK(0,0)", "=BESSELK(-2,-0.5)"].map((formula, row) => ({ row, column: 0, formula, formulaDirty: true, value: { kind: "number" as const, value: 9 } })) }] }; },
    async write(book) { expect(book.sheets[0]!.cells.map(cell => cell.value)).toEqual(Array.from({ length: 3 }, () => ({ kind: "error", value: "#NUM!" }))); return new TextEncoder().encode("#NUM!\n#NUM!\n#NUM!\n"); } };
  const engine = createEngine({ codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { cells: 10, sheets: 1, operations: 10, inputBytes: 1000, outputBytes: 1000, workbookWork: 10000 } });
  try {
    const result = await engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])] }, exportType: "original", destination: { kind: "stream", sink: { async write() { events.push("output"); } } } },
      { signal: new AbortController().signal, async diagnostic(diagnostic) { warnings.push(diagnostic); events.push("notice"); await Promise.resolve(); events.push("settled"); } });
    expect(result.exitCode).toBe(0);
    expect(events).toEqual(["notice", "settled", "notice", "settled", "output"]);
    expect(warnings.map(warning => warning.message)).toEqual(["sf-bessel: trouble in bessel_k", "sf-bessel: trouble in bessel_k"]);
    expect(result.diagnostics).toEqual(warnings);
  } finally { await engine.dispose(); }
});

it.each(["cancel", "reject"])("preserves %s reason identity during numeric diagnostics without publishing", async action => {
  const controller = new AbortController(), reason = { action };
  let writes = 0;
  const codec: Codec = { id: "original", description: "Original diagnostic cancellation fixture", extensions: ["original"], probeContent: () => true,
    async read() { return { sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula: "=BESSELK(-1,0)", formulaDirty: true, value: { kind: "number" as const, value: 9 } }] }] }; },
    async write() { writes++; return new Uint8Array(); } };
  const engine = createEngine({ codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { cells: 10, sheets: 1, operations: 10, inputBytes: 1000, outputBytes: 1000, workbookWork: 10000 } });
  try {
    await expect(engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])] }, exportType: "original", destination: { kind: "stream", sink: { async write() { writes++; } } } },
      { signal: controller.signal, async diagnostic() { if (action === "cancel") controller.abort(reason); else throw reason; } })).rejects.toBe(reason);
    expect(writes).toBe(0);
  } finally { await engine.dispose(); }
});
