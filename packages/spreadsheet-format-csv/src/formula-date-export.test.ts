import { expect, it } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { csvFormat } from "./index.js";

it.each([
  ["=DATE(2024,2,29)", "2024/02/29"],
  ["=DATE(2024,1,1)", "2024/01/01"],
  ["=EDATE(DATE(2024,1,31),1)", "2024/02/29"],
  ["=EOMONTH(DATE(2024,2,1),0)", "2024/02/29"],
  ["=(DATE(2024,2,29))", "2024/02/29"],
  ["=DATE(2024,2,29)+0", "45351"],
  ["=YEAR(DATE(2024,2,29))", "2024"],
  ["=DATE(2024,2,29)-DATE(2024,2,28)", "1"],
  ["=DATE(2024,13,1)", "2025/01/01"],
  ["=DATE(-1,1,1)", "#NUM!"]
])("exports the inferred date format for %s", async (formula, expected) => {
  const engine = createEngine({ formats: [csvFormat] });
  const chunks: number[] = [];
  try {
    await engine.convert({
      input: { kind: "stream", filename: "input.csv", source: [new TextEncoder().encode(`"${formula}"\n`)] },
      importType: "Gnumeric_stf:stf_csvtab", exportType: "Gnumeric_stf:stf_csv",
      destination: { kind: "stream", sink: { async write(bytes) { chunks.push(...bytes); } } }
    }, { signal: new AbortController().signal });
    expect(new TextDecoder().decode(Uint8Array.from(chunks))).toBe(`${expected}\n`);
  } finally { await engine.dispose(); }
});
