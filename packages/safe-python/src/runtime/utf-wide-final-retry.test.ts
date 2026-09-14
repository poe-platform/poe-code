import {expect, it} from "vitest";
import reference from "./__snapshots__/utf-wide-final-retry-3.14.7.json";
import {PythonDecodeError} from "./decode-error.js";
import {WideUnicodeDecoder} from "./utf-wide-incremental.js";
import type {Utf8DecodeErrors} from "./utf8-decode.js";

it.each(reference.cases)("UTF-$width $order finalization and retry with $policy", row => {
  const decoder = new WideUnicodeDecoder(row.width as 16 | 32, 0, row.policy as Utf8DecodeErrors);
  for (const action of row.actions) {
    decoder.errors = action.policy as Utf8DecodeErrors;
    if (action.reset) decoder.reset();
    let actual;
    try {
      actual = {points: [...decoder.decode(new Uint8Array(action.input), action.final)]};
    } catch (error) {
      if (!(error instanceof PythonDecodeError)) throw error;
      const initial = error.initial ?? error;
      actual = {error: {
        encoding: error.encoding, object: [...error.object], start: error.start,
        end: error.end, reason: error.reason,
        args: [error.encoding, [...error.object], initial.start, initial.end, initial.reason]
      }};
    }
    expect(actual).toEqual(action.result);
    const [pending, order] = decoder.getstate();
    expect({pending: [...pending], order: Number(order)}).toEqual(action.state);
  }
});
