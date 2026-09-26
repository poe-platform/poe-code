import { expect, it } from "vitest";
import { createEngine } from "../engine.js";
import { runCommand } from "../cli.js";
import { perlSampleFunctions } from "../formulas/optional-providers.js";
import { byteStringQuotingCases, byteStringQuotingInputHex } from "./byte-string-quoting-fixtures.js";
import { byteStringArrayCase } from "./byte-string-array-fixtures.js";

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], h => parseInt(h, 16));
it.each([...byteStringQuotingCases.filter(vector => vector.exit === 0).map(vector => ({ ...vector, inputHex: byteStringQuotingInputHex })),
  { ...byteStringArrayCase, label: "native-array", args: ["-T", "Gnumeric_stf:stf_csv"] }])("matches native opaque-byte CSV quoting $label", async vector => {
  const input = bytes(vector.inputHex), output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const engine = createEngine({ codecs: [], runtimeFunctions: perlSampleFunctions,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: { async read() { return [input]; }, async write() { throw new Error("unexpected publication"); } },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 1000, sheets: 3, operations: 1000 } });
  try {
    const result = await runCommand(["--recalc", ...vector.args, "/input.gnumeric", "fd://1"], engine, {
      signal: new AbortController().signal, stdout: { async write(b) { output.push(new Uint8Array(b)); } }, stderr: { async write(b) { errors.push(new Uint8Array(b)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(new Uint8Array(output.flatMap(b => [...b]))).toEqual(bytes(vector.stdoutHex));
  } finally { await engine.dispose(); }
});
