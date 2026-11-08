import assert from "node:assert/strict";
import { it } from "node:test";
import * as XLSX from "@e965/xlsx";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runSofficeCli, runSofficeCliSync, runSofficeFileCli } from "./index.js";

for (const route of ["async", "sync", "file"]) {
  for (const format of ["csv", "html"]) {
    it(`${route} exports XLSX Boolean cells as ${format} display values`, async () => {
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Flag", "Number", "Text", "Formula"],
        [true, 1, "1", true],
        [false, 0, "0", false]
      ]);
      sheet.D2!.f = "1=1";
      sheet.D3!.f = "1=0";
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, "Booleans");
      const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
      const files = new Map([["/bool.xlsx", bytes]]);
      const args = ["--headless", "--convert-to", format, "--outdir", "/out", "/bool.xlsx"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/bool.xlsx", bytes);
      const result = await (route === "file"
        ? runSofficeFileCli(args, { filesystem: fs, stdout: { async write() {} }, stderr: { async write() {} } })
        : (route === "sync" ? runSofficeCliSync : runSofficeCli)(args, files));
      assert.equal(result.exitCode, 0);
      const output = new TextDecoder().decode(route === "file" ? await fs.readFile(`/out/bool.${format}`) : files.get(`/out/bool.${format}`));
      if (format === "csv") {
        assert.equal(output, "Flag,Number,Text,Formula\nTRUE,1,1,TRUE\nFALSE,0,0,FALSE\n");
      } else {
        assert.ok(output.includes("<tr><td>TRUE</td><td>1</td><td>1</td><td>TRUE</td></tr>"), output);
        assert.ok(output.includes("<tr><td>FALSE</td><td>0</td><td>0</td><td>FALSE</td></tr>"), output);
      }
    });
  }
}
