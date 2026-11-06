import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosString, dictSet } from "@poe-code/pdf-ast";
import { createPdfinfoCommand, inspectPdfBytes, runPdfinfoCli } from "./index.js";

for (const [timeZone, creation, modification] of [
  ["America/Chicago", "Tue Nov 22 12:15:03 2011 CST", "Fri Jul  1 19:19:36 2011 CDT"],
  ["UTC", "Tue Nov 22 18:15:03 2011 UTC", "Sat Jul  2 00:19:36 2011 UTC"],
] as const) {
  for (const mode of ["normal", "iso", "raw"] as const) {
    it(`formats both metadata dates in ${timeZone} (${mode}) across retained and buffered APIs`, async () => {
      const doc = PdfDocument.create(); doc.addPage(); doc.setTitle("Dates");
      const info = doc.cos.resolveDict(doc.cos.infoRef!)!;
      dictSet(info, "CreationDate", cosString("D:20111122101503-08'00'"));
      dictSet(info, "ModDate", cosString("D:20110702001936Z"));
      const bytes = doc.save();
      const flags = mode === "normal" ? [] : [mode === "iso" ? "-isodates" : "-rawdates"];
      const expected = mode === "normal" ? [creation, modification] : mode === "iso"
        ? ["2011-11-22T10:15:03-08", "2011-07-02T00:19:36Z"]
        : ["D:20111122101503-08'00'", "D:20110702001936Z"];
      const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes);
      let stdout = "", stderr = "";
      const result = await createPdfinfoCommand().execute({
        command: "pdfinfo", args: [...flags, "in.pdf"], cwd: "/", env: { TZ: timeZone }, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      });
      const outputs = [
        { ...result, stdout, stderr },
        inspectPdfBytes(bytes, flags, { timeZone }),
        await runPdfinfoCli([...flags, "in.pdf"], new Map([["in.pdf", bytes]]), undefined, undefined, timeZone),
        await runPdfinfoCli([...flags, "-"], new Map(), bytes, undefined, timeZone),
      ];
      for (const output of outputs) {
        assert.equal(output.exitCode, 0); assert.equal(output.stderr, "");
        assert.ok(output.stdout.includes(`CreationDate:    ${expected[0]}\n`), output.stdout);
        assert.ok(output.stdout.includes(`ModDate:         ${expected[1]}\n`), output.stdout);
      }
    });
  }
}
