import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createPdfinfoCommand, inspectPdfBytes, runPdfinfoCli } from "./index.js";

for (const empty of [false, true]) {
  for (const mode of ["normal", "iso", "raw"] as const) {
    it(`prints only sorted Info strings with -custom (${mode}, empty=${empty})`, async () => {
      const doc = PdfDocument.create(); doc.addPage(); doc.setTitle("Print");
      const info = doc.cos.resolveDict(doc.cos.infoRef!)!;
      info.entries.length = 0;
      if (!empty) {
        dictSet(info, "zebra", cosString("last"));
        dictSet(info, "Title", cosString("Print"));
        dictSet(info, "CreationDate", cosString("D:20111122181503Z"));
        dictSet(info, "Alpha", doc.cos.allocateObject(cosString("first")));
        dictSet(info, "ModDate", cosString("D:20111122181936Z"));
        dictSet(info, "Zoo", cosString("before lowercase"));
      }
      dictSet(info, "Number", cosNumber(42));
      const bytes = doc.save();
      const flags = ["-custom", ...(mode === "normal" ? [] : [mode === "iso" ? "-isodates" : "-rawdates"])];
      const creation = mode === "normal" ? "Tue Nov 22 18:15:03 2011 UTC" : mode === "iso" ? "2011-11-22T18:15:03Z" : "D:20111122181503Z";
      const modification = mode === "normal" ? "Tue Nov 22 18:19:36 2011 UTC" : mode === "iso" ? "2011-11-22T18:19:36Z" : "D:20111122181936Z";
      const expected = { exitCode: 0, stderr: "", stdout: empty ? "" : `Alpha:           first\nCreationDate:    ${creation}\nModDate:         ${modification}\nTitle:           Print\nZoo:             before lowercase\nzebra:           last\n` };
      assert.deepEqual(inspectPdfBytes(bytes, flags), expected);
      assert.deepEqual(await runPdfinfoCli([...flags, "in.pdf"], new Map([["in.pdf", bytes]])), expected);
      const fs = createMemoryFileSystem(); await fs.writeFile("/in.pdf", bytes);
      let stdout = "", stderr = "";
      const result = await createPdfinfoCommand().execute({
        command: "pdfinfo", args: [...flags, "in.pdf"], cwd: "/", env: { TZ: "UTC" }, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      });
      assert.deepEqual({ ...result, stdout, stderr }, expected);
      assert.deepEqual(await fs.readdir("/tmp"), []);
    });
  }
}
