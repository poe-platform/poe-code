import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import { createPerlSampleFunctions } from "./optional-providers.js";
import type { CapabilityContext } from "../contracts.js";
import { byteStringValue } from "@poe-code/spreadsheet-ast/byte-value";

const context: CapabilityContext = { own() {}, signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 3, operations: 10000 } };
// Activated Gnumeric 1.12.61 Perl loader; C-string arguments, byte-oriented matching.
const cases = [
  [
    "source-nul",
    "610062",
    "62",
    "58",
    "61"
  ],
  [
    "pattern-nul",
    "6162",
    "610062",
    "58",
    "5862"
  ],
  [
    "replacement-nul",
    "616261",
    "61",
    "580059",
    "586258"
  ],
  [
    "leading-source-nul",
    "006162",
    "61",
    "58",
    ""
  ],
  [
    "leading-pattern-nul",
    "6162",
    "0061",
    "58",
    "5861586258"
  ],
  [
    "leading-replacement-nul",
    "616261",
    "61",
    "0058",
    "62"
  ],
  [
    "utf8-byte-dot",
    "c3a9f09f9880",
    "2e",
    "58",
    "585858585858"
  ],
  [
    "utf8-literal",
    "c3a9c3a9",
    "c3a9",
    "58",
    "5858"
  ],
  [
    "invalid-utf8",
    "ff8061",
    "2e",
    "58",
    "585858"
  ],
  [
    "invalid-result",
    "c3a9",
    "a9",
    "58",
    "c358"
  ],
  [
    "nul-after-invalid",
    "ff0061",
    "61",
    "58",
    "ff"
  ],
  [
    "empty-input",
    "",
    "61",
    "58",
    ""
  ]
] as const;

for (const version of ["5.34.1", "5.40.1"] as const)
it.each(cases)(`${version} matches native transport: %s`, (_name, source, pattern, replacement, expected) => {
  const values = [source, pattern, replacement].map(hex => {
    const bytes = Buffer.from(hex, "hex"), text = bytes.toString("utf8");
    return Buffer.from(text).equals(bytes) ? { kind: "string" as const, value: text }
      : byteStringValue(bytes, () => {}, 100000);
  });
  const book = { sheets: [{ id: "s", name: "S", cells: [
    ...values.map((value, column) => ({ row: 0, column, value })),
    { row: 0, column: 3, formula: "=PERL_SED(A1,B1,C1)", formulaDirty: true, value: { kind: "blank" as const } }
  ] }] };
  const calculated = recalculateWorkbook(book, { ...context, runtimeFunctions: createPerlSampleFunctions({ version }) });
  const value = calculated.sheets[0]!.cells.find(cell => cell.column === 3)!.value;
  expect(value.kind === "string" ? Buffer.from(value.value).toString("hex") : value.kind === "byte-string" ? value.value : value).toBe(expected);
});
