import { expect, it } from "vitest";
import { byteCaseContexts } from "./byte-case-fixtures.js";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";
import { createEngine, perlSampleFunctions } from "../../index.js";
import { caseByteText } from "./byte-case.js";

const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;

it.each(byteCaseContexts)("LOWER preserves captured Unicode16 byte/context behavior $inputHex", vector => {
  const value = byteStringValue(bytes(vector.inputHex), () => {}, 1000000);
  expect(textFunctions.LOWER!([value], host)).toEqual(byteStringValue(bytes(vector.lowerHex), () => {}, 1000000));
});
it.each(byteCaseContexts)("UPPER preserves captured Unicode16 byte/context behavior $inputHex", vector => {
  const value = byteStringValue(bytes(vector.inputHex), () => {}, 1000000);
  expect(textFunctions.UPPER!([value], host)).toEqual(byteStringValue(bytes(vector.upperHex), () => {}, 1000000));
});

it.each(["LOWER", "UPPER"])("%s cooperates during source admission and case traversal", name => {
  let work = 0;
  const cooperativeHost = { ...host, tick() { if (++work === 9) throw new Error("case cancellation"); } };
  expect(() => textFunctions[name]!([{ kind: "string", value: "A".repeat(100) }], cooperativeHost)).toThrow("case cancellation");
  expect(work).toBe(9);
});

it("admits full-case expansion before allocating the result and preserves owned bounds", () => {
  const source = new TextEncoder().encode("ΐ");
  expect(() => caseByteText(source, true, 3, () => {})).toThrow("text limit");
  expect(caseByteText(source, true, 6, () => {})).toEqual(bytes("ce99cc88cc81"));
  const invalid = Uint8Array.of(0xc3), owned = caseByteText(invalid, true, 1, () => {});
  invalid[0] = 65;
  expect(owned).toEqual(Uint8Array.of(0xc3));
  expect(caseByteText(Uint8Array.of(65, 0, 66), false, 1, () => {})).toEqual(Uint8Array.of(97));
});

it("cooperates during transformation after complete source admission", () => {
  let work = 0;
  const source = new Uint8Array(100).fill(65);
  expect(() => caseByteText(source, false, 100, () => { if (++work === 130) throw false; })).toThrow();
  expect(work).toBe(130);
});

it.each(["LOWER", "UPPER"])("%s rejects malformed visible host UTF16 and ignores the C-string tail", name => {
  expect(() => textFunctions[name]!([{ kind: "string", value: "\ud800" }], host)).toThrow("text byte representation");
  expect(textFunctions[name]!([{ kind: "string", value: "a\0\ud800" }], host)).toEqual({ kind: "string", value: name === "UPPER" ? "A" : "a" });
});

it("public SDK exports opaque native bytes after UPPER without replacement decoding", async () => {
  const engine = createEngine({ codecs: [], runtimeFunctions: perlSampleFunctions,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 2000, sheets: 4, operations: 10000 } });
  const source = new TextEncoder().encode(String.raw`<Workbook xmlns="http://www.gnumeric.org/v10.dtd"><Sheets><Sheet><Name>S</Name><Cells><Cell Row="0" Col="0">=PERL_SED("ä","\\xA4","")</Cell><Cell Row="0" Col="1">=UPPER(A1)</Cell></Cells></Sheet></Sheets></Workbook>`);
  const chunks: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: "stream", filename: "input.gnumeric", source: [source] },
      recalc: true, exportType: "Gnumeric_stf:stf_csv", destination: { kind: "stream", sink: {
        async write(chunk) { chunks.push(new Uint8Array(chunk)); }
      } } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(Uint8Array.from(chunks.flatMap(chunk => Array.from(chunk)))).toEqual(Uint8Array.of(0xc3, 44, 0xc3, 10));
  } finally { await engine.dispose(); }
});
