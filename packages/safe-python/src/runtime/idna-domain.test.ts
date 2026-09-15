import {expect, it} from "vitest";
import reference from "./__snapshots__/idna-domain-3.14.7.json";
import edgeReference from "./__snapshots__/idna-domain-edge-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeIdnaDomain, encodeIdnaDomain} from "./idna-domain.js";

function fault(error: PythonRuntimeError): unknown {
  return {name: error.name, message: error.message, suppressContext: error.chaining?.suppressContext ?? false,
    ...(error instanceof PythonEncodeError || error instanceof PythonDecodeError ? {
      encoding: error.encoding, object: [...error.object], start: String(error.start), end: String(error.end), reason: error.reason
    } : {}), ...(error.chaining === undefined ? {} : {context: fault(error.chaining.context)})};
}

it("pins the external domain reference version", () => {
  for (const corpus of [reference, edgeReference]) {
    expect(corpus.oracle.version.startsWith("3.14.7 ")).toBe(true);
    expect(corpus.oracle.unicode).toBe("16.0.0");
  }
});

it("retains actual surrogate, bidi, mapped-away and non-ASCII byte inputs in the edge corpus", () => {
  const textPoints = new Set(edgeReference.cases.filter(row => row.operation === "encode").flatMap(row => row.input));
  for (const point of [0xad, 0x5d0, 0x200d, 0x202e, 0xd800, 0xdfff, 0x1f40d, 0x10ffff]) expect(textPoints.has(point)).toBe(true);
  const bytePoints = new Set(edgeReference.cases.filter(row => row.operation === "decode").flatMap(row => row.input));
  for (let byte = 128; byte < 256; byte++) expect(bytePoints.has(byte)).toBe(true);
});

for (const [name, corpus] of [["", reference], ["edge ", edgeReference]] as const) {
  for (let start = 0; start < corpus.cases.length; start += 50) {
    it(`matches ${name}domain results and complete fault chains ${start}..${Math.min(start + 50, corpus.cases.length)}`, () => {
      const rows = corpus.cases.slice(start, start + 50);
      const actual = rows.map(row => {
        const meter = new ExecutionBudget({maxSteps: 1000000, maxAllocatedBytes: 8000000});
        const identity = {operation: row.operation, input: row.input, errors: row.errors};
        try {
          const result = row.operation === "encode"
            ? encodeIdnaDomain(new CodePointString(Uint32Array.from(row.input)), row.errors, meter)
            : decodeIdnaDomain(Uint8Array.from(row.input), row.errors, meter);
          return {...identity, result: [...result.output], consumed: result.consumed};
        } catch (error) {if (!(error instanceof PythonRuntimeError)) throw error; return {...identity, error: fault(error)};}
      });
      expect(actual).toEqual(rows);
    });
  }
}

it.each(["Example", "bücher.example", "a..é", "a.\ud800", "a.\u00ad"].map(text => ({text})))(
  "retains input and stops immediately on cancellation: $text", ({text}) => {
    const input = new CodePointString(Uint32Array.from(Array.from(text, character => character.codePointAt(0)!)));
    const original = [...input];
    let count = 0;
    try {encodeIdnaDomain(input, "strict", {checkpoint() {count++;}});}
    catch (error) {if (!(error instanceof PythonRuntimeError)) throw error;}
    for (let stop = 1; stop <= count; stop++) {
      const cancelled = new ExecutionLimitError("cancelled");
      let calls = 0, failure: unknown;
      try {encodeIdnaDomain(input, "strict", {checkpoint() {if (++calls === stop) throw cancelled;}});}
      catch (error) {failure = error;}
      expect(failure).toBe(cancelled);
      expect(calls).toBe(stop);
      expect([...input]).toEqual(original);
    }
  });

it.each(["Example", "a.xn--bcher-kva", "a.xn--a!", "a.xn--abc-", "a.\xff"].map(text => ({text})))(
  "retains bytes and stops immediately on decoder cancellation: $text", ({text}) => {
    const input = Uint8Array.from(Array.from(text, character => character.codePointAt(0)!));
    const original = [...input];
    let count = 0;
    try {decodeIdnaDomain(input, "strict", {checkpoint() {count++;}});}
    catch (error) {if (!(error instanceof PythonRuntimeError)) throw error;}
    for (let stop = 1; stop <= count; stop++) {
      const cancelled = new ExecutionLimitError("cancelled");
      let calls = 0, failure: unknown;
      try {decodeIdnaDomain(input, "strict", {checkpoint() {if (++calls === stop) throw cancelled;}});}
      catch (error) {failure = error;}
      expect(failure).toBe(cancelled);
      expect(calls).toBe(stop);
      expect([...input]).toEqual(original);
    }
  });
