import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSofficeCommand, runSofficeCli, runSofficeCliSync } from "./index.js";

for (const fixture of ["grid", "empty-cell", "overflow", "plain"]) {
  it(`preserves DOCX table geometry in every route (${fixture})`, async () => {
    const input = await readFile(new URL(`./fixtures/tables/${fixture}.docx`, import.meta.url));
    const rows = fixture === "empty-cell" ? [["Left", "Middle", "Right"], ["A", "", "C"]]
      : fixture === "overflow" ? [["Name", "Count"], ...Array.from({ length: 40 }, (_, i) => [`Row ${i + 1}`, `Value ${i + 1}`])]
      : [["Name", "Count"], ["Alpha", "Seven"]];
    let reference: unknown;
    for (const mode of ["sync", "async", "command"]) {
      const files = new Map([["/doc.docx", new Uint8Array(input)]]), fs = new MemoryFileSystem();
      await fs.mkdir("/scratch");
      await fs.writeFile("/doc.docx", input);
      const args = ["--convert-to", "pdf", "/doc.docx"];
      const result = mode === "sync" ? runSofficeCliSync(args, files) : mode === "async" ? await runSofficeCli(args, files)
        : await createSofficeCommand().execute({ command: "soffice", cwd: "/", env: { TMPDIR: "/scratch" }, fs, ...createCommandArguments(args), signal: new AbortController().signal, stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} } });
      assert.equal(result.exitCode, 0);
      const pdf = PdfDocument.load(mode === "command" ? await fs.readFile("/doc.pdf") : files.get("/doc.pdf")!);
      assert.equal(pdf.pageCount, fixture === "overflow" ? 2 : 1);
      const pages = Array.from({ length: pdf.pageCount }, (_, i) => pdf.getPage(i).evaluateDisplayList());
      const geometry = pages.map(page => ({ glyphs: page.glyphs.map(g => [g.unicode, g.matrix[4], g.baselineY, g.fontSize, g.fontName]), paths: page.paths }));
      if (reference) assert.deepEqual(geometry, reference);
      reference = geometry;
      const glyphs = pages.flatMap(page => page.glyphs);
      const text = glyphs.map(g => g.unicode).join("");
      assert.equal(text, fixture === "grid" || fixture === "plain" ? `Before table${rows.flat().join("")}After table` : rows.flat().join(""));
      assert.equal(pages.flatMap(page => page.paths).length, fixture === "plain" ? 0 : rows.length * rows[0]!.length);
      let offset = fixture === "grid" ? "Before table".length : 0;
      let y = fixture === "grid" ? 700 : 720;
      if (fixture !== "plain") for (const row of rows) {
        if (y - 28 < 54) y = 720;
        for (const [column, cell] of row.entries()) {
          if (cell) {
            assert.equal(glyphs[offset]!.matrix[4], 60 + column * 504 / row.length);
            assert.equal(glyphs[offset]!.baselineY, y - 16);
            assert.equal(glyphs[offset]!.fontSize, 10);
          }
          offset += cell.length;
        }
        y -= 22;
      }
      if (fixture === "grid") assert.equal(glyphs[offset]!.baselineY, 642);
      if (fixture === "plain") {
        let start = 0;
        for (const [i, paragraph] of ["Before table", ...rows.flat(), "After table"].entries()) {
          assert.equal(glyphs[start]!.matrix[4], 54);
          assert.equal(glyphs[start]!.baselineY, 720 - i * 20);
          start += paragraph.length;
        }
      }
      assert.deepEqual(new Uint8Array(mode === "command" ? await fs.readFile("/doc.docx") : files.get("/doc.docx")!), new Uint8Array(input));
      assert.deepEqual(await fs.readdir("/scratch"), []);
    }
  });
}
