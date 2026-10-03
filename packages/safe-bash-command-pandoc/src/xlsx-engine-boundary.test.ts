import { expect, it, vi } from "vitest";
import { utils, write } from "@e965/xlsx";
import { readDocument } from "./index.js";

vi.mock("safe-bash-command-ssconvert", () => {
  throw new Error("Spreadsheet consumers must not load the ssconvert command");
});

it("reads and recalculates XLSX through the independent spreadsheet engines", async () => {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([["Value"], [4]]);
  sheet.A2 = { t: "n", f: "2+2" };
  utils.book_append_sheet(workbook, sheet, "Results");
  const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
  const result = await readDocument({ bytes }, { from: "xlsx" }, { yield: async () => {} });
  expect(JSON.stringify(result.blocks)).toContain('"c":"4"');
});
