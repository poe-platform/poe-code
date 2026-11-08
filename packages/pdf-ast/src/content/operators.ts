/* Operator arities and recovery rules adapted from Mozilla PDF.js.
 * Copyright 2017 Mozilla Foundation. Licensed under Apache-2.0.
 * See THIRD_PARTY_NOTICES.md and licenses/PDFJS-APACHE-2.0.txt.
 */

/** Fixed arities from PDF.js EvaluatorPreprocessor.opMap. */
export const PDF_OPERATOR_ARITIES: Readonly<Record<string, number>> = {
  w: 1, J: 1, j: 1, M: 1, d: 2, ri: 1, i: 1, gs: 1, q: 0, Q: 0, cm: 6,
  m: 2, l: 2, c: 6, v: 4, y: 4, h: 0, re: 4,
  S: 0, s: 0, f: 0, F: 0, "f*": 0, B: 0, "B*": 0, b: 0, "b*": 0, n: 0, W: 0, "W*": 0,
  BT: 0, ET: 0, Tc: 1, Tw: 1, Tz: 1, TL: 1, Tf: 2, Tr: 1, Ts: 1,
  Td: 2, TD: 2, Tm: 6, "T*": 0, Tj: 1, TJ: 1, "'": 1, '"': 3,
  d0: 2, d1: 6, CS: 1, cs: 1, G: 1, g: 1, RG: 3, rg: 3, K: 4, k: 4,
  sh: 1, BI: 0, ID: 0, EI: 1, Do: 1,
  MP: 1, DP: 2, BMC: 1, BDC: 2, EMC: 0, BX: 0, EX: 0,
};
export const PDF_VARIABLE_OPERATORS = new Set(["SC", "SCN", "sc", "scn"]);
export const PDF_PATH_OPERATORS = new Set([
  "m", "l", "c", "v", "y", "h", "re", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n",
]);

// Reserved partial commands in PDF.js EvaluatorPreprocessor.opMap.
export const PDF_KNOWN_COMMANDS = new Set([
  ...Object.keys(PDF_OPERATOR_ARITIES), ...PDF_VARIABLE_OPERATORS,
  "BM", "BD", "true", "fa", "fal", "fals", "false", "nu", "nul", "null",
]);
