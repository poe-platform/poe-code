import {expect, it} from "vitest";
import {lookupUnicodeName} from "./unicode-names.js";
import {ExecutionLimitError, type ExecutionMeter} from "./runtime/execution-budget.js";
import {decodeUnicodeEscape} from "./runtime/unicode-escape.js";

it.each(["cancelled", "steps", "allocation"] as const)("preserves %s termination at every Unicode-name codec checkpoint", reason => {
  for (const name of ["LATIN CAPITAL LETTER A", "CJK UNIFIED IDEOGRAPH-4E00", "TODHRI LETTER A", "UNKNOWN CHARACTER"]) {
    let checkpoints = 0;
    lookupUnicodeName(name, {checkpoint() {checkpoints++;}});
    for (let stop = 1; stop <= checkpoints; stop++) {
      const failure = new ExecutionLimitError(reason);
      let calls = 0;
      const meter: ExecutionMeter = {checkpoint() {
        calls++;
        if (calls === stop) throw failure;
        if (calls > stop) throw Error("meter entered after termination");
      }};
      let caught: unknown;
      try {lookupUnicodeName(name, meter);} catch (error) {caught = error;}
      expect(caught).toBe(failure);
      expect(calls).toBe(stop);
    }
  }
});

it("does not resume escape decoding, recovery or warnings after name lookup terminates", () => {
  const source = "\\N{TODHRI LETTER A}";
  const input = Uint8Array.from(source, character => character.charCodeAt(0));
  let checkpoints = 0;
  const result = decodeUnicodeEscape(input, false, "strict", {checkpoint() {checkpoints++;}}, true, () => {});
  expect([...result.text]).toEqual([0x105c0]);
  for (let stop = 1; stop <= checkpoints; stop++) {
    const failure = new ExecutionLimitError("cancelled");
    let calls = 0, recovered = false, warned = false;
    const meter: ExecutionMeter = {checkpoint() {
      calls++;
      if (calls === stop) throw failure;
      if (calls > stop) throw Error("meter entered after termination");
    }};
    let caught: unknown;
    try {
      decodeUnicodeEscape(input, false, () => {recovered = true; throw Error("unexpected recovery");}, meter, true, () => {warned = true;});
    } catch (error) {caught = error;}
    expect(caught).toBe(failure);
    expect(calls).toBe(stop);
    expect(recovered).toBe(false);
    expect(warned).toBe(false);
  }
});
