import {expect, it} from "vitest";
import reference from "./__snapshots__/idna-unicode-label-3.14.7.json";
import {CodePointString} from "./code-point-string.js";
import {PythonDecodeError} from "./decode-error.js";
import {PythonEncodeError} from "./encode-error.js";
import {PythonRuntimeError} from "./error.js";
import {ExecutionBudget, ExecutionLimitError} from "./execution-budget.js";
import {decodeIdnaUnicodeLabel} from "./idna-unicode-label.js";

function fault(error: PythonRuntimeError): unknown {
  return {name: error.name, message: error.message, suppressContext: error.chaining?.suppressContext ?? false,
    ...(error instanceof PythonEncodeError || error instanceof PythonDecodeError ? {
      encoding: error.encoding, object: [...error.object], start: String(error.start), end: String(error.end), reason: error.reason
    } : {}), ...(error.chaining === undefined ? {} : {context: fault(error.chaining.context)})};
}

it("matches pinned ToUnicode text/bytes labels and complete internal fault chains", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  const actual = reference.cases.map(row => {
    const input = row.kind === "text" ? new CodePointString(Uint32Array.from(row.input)) : Uint8Array.from(row.input);
    const meter = new ExecutionBudget({maxSteps: 1000000, maxAllocatedBytes: 8000000});
    const identity = {kind: row.kind, input: row.input};
    try { return {...identity, result: [...decodeIdnaUnicodeLabel(input, meter)]}; }
    catch (error) {if (!(error instanceof PythonRuntimeError)) throw error; return {...identity, error: fault(error)};}
  });
  expect(actual).toEqual(reference.cases);
});

it.each(["Example", "XN--bcher-kva", "xn--a!", "xn--abc-", "é", "Ａ", "\ud800"].map(text => ({text})))(
  "propagates cancellation without further work: $text", ({text}) => {
    const points = Array.from(text, character => character.codePointAt(0)!);
    const input = new CodePointString(Uint32Array.from(points));
    let count = 0;
    try {decodeIdnaUnicodeLabel(input, {checkpoint() {count++;}});}
    catch (error) {if (!(error instanceof PythonRuntimeError)) throw error;}
    for (let stop = 1; stop <= count; stop++) {
      const cancelled = new ExecutionLimitError("cancelled");
      let calls = 0, failure: unknown;
      try {decodeIdnaUnicodeLabel(input, {checkpoint() {if (++calls === stop) throw cancelled;}});}
      catch (error) {failure = error;}
      expect(failure).toBe(cancelled);
      expect(calls).toBe(stop);
      expect([...input]).toEqual(points);
    }
  });
