import assert from "node:assert/strict";
import { test } from "vitest";
import { guessQuotes } from "./sniffer-quotes.js";
import { PYTHON_WORD_CLASS } from "./sniffer-unicode.js";

// CPython v3.14.2 Lib/csv.py _guess_quote_and_delimiter, Agate's six delimiters.
const step = (): void => {};

test("sniffer quote stress: regex alternatives stop at the first matching shape", () => {
  assert.deepEqual(guessQuotes('a;"x";b\n"more","quoted"\n', step), {
    quotechar: '"', delimiter: ";", doublequote: true, skipinitialspace: false
  });
});

test("sniffer quote stress: tied counts retain first observed delimiter and quote", () => {
  assert.deepEqual(guessQuotes('a;\'x\';b\na,"y",b\n', step), {
    quotechar: "'", delimiter: ";", doublequote: false, skipinitialspace: false
  });
});

test("sniffer quote stress: spaces count all matching delimiters, including excluded ones", () => {
  assert.deepEqual(guessQuotes('a, "x",b\na~ "y"~b\n', step), {
    quotechar: '"', delimiter: ",", doublequote: false, skipinitialspace: false
  });
});

test("sniffer quote stress: Unicode letters and numbers cannot delimit quote matches", () => {
  for (const word of ["é", "中", "Ⅷ", "²", "_"])
    assert.equal(guessQuotes(`a${word}"x"${word}b\n`, step), undefined);
});

test("sniffer quote stress: quoted single-column input preserves inference without delimiter", () => {
  assert.deepEqual(guessQuotes('"abc"\n"de"\n', step), {
    quotechar: '"', delimiter: "", doublequote: false, skipinitialspace: false
  });
  assert.equal(guessQuotes("", step), undefined);
  assert.equal(guessQuotes("abc\ndef\n", step), undefined);
});

test("sniffer quote stress: doubled quotes use frozen three-quote heuristic", () => {
  assert.deepEqual(guessQuotes('a,"x""y",b\n', step), {
    quotechar: '"', delimiter: ",", doublequote: true, skipinitialspace: false
  });
  assert.deepEqual(guessQuotes('a,"x\ny",b\n', step), {
    quotechar: '"', delimiter: ",", doublequote: false, skipinitialspace: false
  });
});

test("sniffer quote stress: inference cooperatively observes caller interruption", () => {
  assert.throws(() => guessQuotes('a,"x",b\n', () => { throw new Error("cancelled"); }), /cancelled/);
});

test("sniffer quote stress: Python multiline anchors recognize only LF boundaries", () => {
  assert.deepEqual(guessQuotes('"a",x\u2028"b""c",z', step), {
    quotechar: '"', delimiter: ",", doublequote: false, skipinitialspace: false
  });
});

test("sniffer quote stress: Unicode word classes stay frozen across host Unicode upgrades", () => {
  const word = new RegExp(`^[${PYTHON_WORD_CLASS}]$`, "u");
  assert.equal(word.test("\u{1c89}"), true); // Cyrillic letter added in Unicode 16.
  assert.equal(word.test("\u{11db0}"), false); // Tolong Siki letter added in Unicode 17.
  assert.deepEqual(guessQuotes('a\u{11db0}"x"\u{11db0}b', step), {
    quotechar: '"', delimiter: "", doublequote: false, skipinitialspace: false
  });
});
