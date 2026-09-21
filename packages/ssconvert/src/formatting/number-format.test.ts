import { expect, it } from "vitest";
import { formatText } from "./number-format.js";
import type { CapabilityContext } from "../contracts.js";

export const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const host = { context, book: {}, tick() { context.signal.throwIfAborted(); } };

it.each<[number, string, string]>([
  [0.5, "0.??", "0.5 "], [12, "0.??", "12.  "], [0, "#.??", ".  "], [0.5, "?.??", " .5 "],
  [123456789, "000-00-0000", "123-45-6789"], [12, '0\\;"x"', "12;x"],
  [12, '"pre"0"post"', "pre12post"], [12, '"a;b"0', "a;b12"],
  [0, '0;[Red](0);"zero"', "zero"], [1234.5, "[$€-407]#,##0.00", "€1,234.50"],
  [12, "0_);(0)", "12 "], [12, "*x0", "12"],
  [12, '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', " $12.00 "],
  [12, '[>20]0;[<0]0;"else"', "else"], [12, "[>20]0;[<0]0", "12"],
  [5e-324, "0.00E+00", "4.94E-324"], [1e308, "0.00E+00", "1.00E+308"],
  [1234.5, "#.##0,00", "1234.5000"], [1234.5, '"x"@', "1234.5"],
  [1.2345678901234567e30, "0.00", "1234567890123456708408451792896.00"],
  [1e308, "0.00", "100000000000000001097906362944045541740492309677311846336810682903157585404911491537163328978494688899061249669721172515611590283743140088328307009198146046031271664502933027185697489699588559043338384466165001178426897626212945177628091195786707458122783970171784415105291802893207873272974885715430223118336.00"]
])("matches captured unlimited-width native TEXT(%s,%s)", (value, pattern, expected) => {
  expect(formatText({ kind: "number", value }, pattern, host)).toEqual({ kind: "string", value: expected });
});
