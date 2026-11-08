import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createPdfinfoCommand, inspectPdfBytes, runPdfinfoCli } from "./index.js";

const title = "    Title:         ISO 15930 - Electronic document file format for prepress digital data exchange (PDF/X)\n";

for (const [version, part, abbreviation, subtitle, conformance] of [
  ["fixture", 9, "PDF/X", "", ""],
  ["", 9, "PDF/X", "", ""],
  ["PDF/X-1:2001", 1, "PDF/X-1:2001", "Complete exchange using CMYK data (PDF/X-1 and PDF/X-1a)", ""],
  ["PDF/X-1a:2003", 4, "PDF/X-1:2003", "Complete exchange of CMYK and spot colour printing data using PDF 1.4 (PDF/X-1a)", "Level A, Accessible"],
  ["PDF/X-2", 5, "PDF/X-2", "Partial exchange of printing data using PDF 1.4 (PDF/X-2) [Withdrawn]", ""],
  ["PDF/X-3:2002", 3, "PDF/X-3:2002", "Complete exchange suitable for colour-managed workflows (PDF/X-3)", ""],
  ["PDF/X-3:2003", 6, "PDF/X-3:2003", "Complete exchange of printing data suitable for colour-managed workflows using PDF 1.4 (PDF/X-3)", ""],
  ["PDF/X-4p", 7, "PDF/X-4", "Complete exchange of printing data (PDF/X-4) and partial exchange of printing data with external profile reference (PDF/X-4p) using PDF 1.6", "Level P, Embedded ICC profile"],
  ["PDF/X-5pg", 8, "PDF/X-5", "Partial exchange of printing data using PDF 1.6 (PDF/X-5)", "Level PG, Embedded ICC profile and external graphical content"],
  ["unknown", 9, "PDF/X", "", ""],
  [undefined, 0, "", "", ""],
  [42, 0, "", "", ""],
] as const) {
  for (const retained of [false, true]) {
    it(`reports PDF/X subtype ${String(version)} through ${retained ? "retained" : "buffered"} pdfinfo`, async () => {
      const doc = PdfDocument.create(); doc.addPage(); doc.setTitle("Subtype");
      if (version !== undefined) dictSet(doc.cos.resolveDict(doc.cos.infoRef!)!, "GTS_PDFXVersion", typeof version === "number" ? cosNumber(version) : cosString(version));
      const bytes = version === "fixture" ? new Uint8Array(await readFile(new URL("../../pdf-ast/src/fixtures/pdfjs-issue18986.pdf", import.meta.url))) : doc.save();
      let result;
      if (retained) {
        const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes);
        let stdout = "", stderr = "";
        const outcome = await createPdfinfoCommand().execute({
          command: "pdfinfo", args: ["in.pdf"], cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {} },
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        result = { ...outcome, stdout, stderr };
      } else {
        result = await runPdfinfoCli(["in.pdf"], new Map([["in.pdf", bytes]]));
        assert.deepEqual(result, inspectPdfBytes(bytes));
      }
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      const start = result.stdout.indexOf("PDF subtype:");
      if (part === 0) { assert.equal(start, -1); return; }
      const expected = `PDF subtype:    ${version === "fixture" ? "" : version}\n${title}    Abbreviation:  ${abbreviation}\n    Subtitle:      Part ${part}${subtitle ? `: ${subtitle}` : ""}\n    Standard:      ISO 15930-${part}\n${conformance ? `    Conformance:   ${conformance}\n` : ""}`;
      assert.notEqual(start, -1, result.stdout);
      assert.equal(result.stdout.slice(start), expected);
      assert.ok(result.stdout.slice(0, start).trimEnd().split("\n").at(-1)?.startsWith("PDF version:"));
    });
  }
}
