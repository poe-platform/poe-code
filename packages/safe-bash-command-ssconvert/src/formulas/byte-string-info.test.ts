import { expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { perlSampleFunctions } from "./optional-providers.js";
import { byteStringInfoCase } from "./byte-string-info-fixtures.js";

it("retains native text categories through TYPE/N/T/CELL and numerical argument coercion", async () => {
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], h => parseInt(h, 16)), chunks: Uint8Array[] = [];
  const engine = createEngine({ codecs: [], runtimeFunctions: perlSampleFunctions, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 3, operations: 1000 } });
  try {
    const result = await engine.convert({ input: { kind: "stream", filename: "input.gnumeric", source: [bytes(byteStringInfoCase.inputHex)] }, recalc: true,
      exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: { async write(b) { chunks.push(new Uint8Array(b)); } } } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(new Uint8Array(chunks.flatMap(b => [...b]))).toEqual(bytes(byteStringInfoCase.stdoutHex));
  } finally { await engine.dispose(); }
});
