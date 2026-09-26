import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { readText } from "./text.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  inputFilename: "/sampling.csv",
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 5000, sheets: 2, operations: 1000 },
  own() {}
};

// stf_parse_lines starts lineno at 1 and stops after incrementing to maxlines.
it("excludes the thousandth physical line from CSV separator detection", async () => {
  const text = "a,b\n".repeat(999) + '"z"x|w\n';
  const book = await readText(new TextEncoder().encode(text), context);
  expect(book.sheets[0]!.cells.slice(0, 2).map(cell => cell.value)).toEqual([
    { kind: "string", value: "a" }, { kind: "string", value: "b" }
  ]);
  expect(book.sheets[0]!.cells.at(-1)).toMatchObject({ row: 999, column: 0, value: { kind: "string", value: "z" } });
});

it("includes the last sampled physical line and still imports later rows", async () => {
  const text = "a,b\n".repeat(998) + '"z"x|w\nlast|tail\n';
  const book = await readText(new TextEncoder().encode(text), context);
  expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: "a,b" });
  expect(book.sheets[0]!.cells.slice(-2)).toMatchObject([
    { row: 999, column: 0, value: { kind: "string", value: "last" } },
    { row: 999, column: 1, value: { kind: "string", value: "tail" } }
  ]);
});
