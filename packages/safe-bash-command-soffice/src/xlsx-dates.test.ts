import assert from "node:assert/strict";
import { it } from "node:test";
import * as XLSX from "@e965/xlsx";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

for (const date1904 of [false, true]) for (const format of ["csv", "html"]) {
  for (const route of ["sync", "async", "file"]) it(`exports styled XLSX dates to ${format} (${route}, 1904=${date1904})`, async () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Date", "Number", "Formula"], [date1904 ? 43830 : 45292, 12.345, 42], [date1904 ? 43831 : 45293, 0.5, 7]]);
    sheet.A2!.z = sheet.A3!.z = "yyyy-mm-dd";
    sheet.B2!.z = '0.00';
    sheet.C2!.f = "40+2";
    const book = XLSX.utils.book_new();
    book.Workbook = { WBProps: { date1904 } };
    XLSX.utils.book_append_sheet(book, sheet, "Dates");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const args = ["--headless", "--convert-to", format, "--outdir", "/out", "/date.xlsx"];
    let output: Uint8Array;
    if (route === "file") {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/date.xlsx", bytes);
      const result = await runSofficeFileCli(args, { filesystem: fs, stdout: { async write() {} }, stderr: { async write() {} } });
      assert.equal(result.exitCode, 0);
      output = await fs.readFile(`/out/date.${format}`);
    } else {
      const files = new Map([["/date.xlsx", bytes]]);
      const result = await (route === "sync" ? runSofficeCliSync : runSofficeCli)(args, files);
      assert.equal(result.exitCode, 0, result.stderr);
      output = files.get(`/out/date.${format}`)!;
    }
    const text = new TextDecoder().decode(output);
    if (format === "csv") assert.equal(text, "Date,Number,Formula\n2024-01-01,12.345,42\n2024-01-02,0.5,7\n");
    else for (const value of ["2024-01-01", "2024-01-02", "12.345", "0.5", "42"]) assert.ok(text.includes(`<td>${value}</td>`), text);
  });
}

for (const run of [runSofficeCliSync, runSofficeCli]) it(`preserves built-in and custom date displays (${run.name})`, async () => {
  const sheet = XLSX.utils.aoa_to_sheet([[45292, 45292.5, 0.5, 12.345, "45292"]]);
  ["m/d/yy", 'yyyy-mm-dd" at "hh:mm', "h:mm", '0.00" days"', "yyyy-mm-dd"].forEach((format, column) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c: column })]!.z = format;
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Dates");
  const files = new Map([["/dates.xlsx", new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }))]]);
  const result = await run(["--convert-to", "csv", "/dates.xlsx"], files);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(files.get("/dates.csv")), "1/1/24,2024-01-01 at 12:00,12:00,12.345,45292\n");
});
