import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdfimagesCommand, runPdfimagesCli, runPdfimagesCliSync } from "./index.js";

const damaged = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/pdfjs-issue9418.pdf", import.meta.url)));
const document = PdfDocument.create();
document.addPage([72, 72]);
const blank = document.save();

for (const mode of ["buffered", "sync", "retained"] as const) {
  for (const list of [false, true]) {
    it.each([false, true])(`${mode} rejects an unusable page tree (list=${list}, quiet=%s) but accepts pages without images`, async quiet => {
      const argv = [...(quiet ? ["-q"] : []), ...(list ? ["-list", "in.pdf"] : ["in.pdf", "out"])];
      for (const input of [damaged, blank]) {
        let result;
        if (mode === "retained") {
          const fs = createMemoryFileSystem();
          await fs.mkdir("/tmp");
          await fs.writeFile("/in.pdf", input);
          const args = createCommandArguments(argv);
          let stdout = "", stderr = "";
          const status = await createPdfimagesCommand().execute({
            command: "pdfimages", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
            stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
          });
          result = { ...status, stdout, stderr };
          expect(await fs.readdir("/tmp")).toEqual([]);
          expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["in.pdf", "tmp"]);
        } else {
          const files = new Map([["in.pdf", input]]);
          result = await (mode === "sync" ? runPdfimagesCliSync : runPdfimagesCli)(argv, files);
          expect([...files.keys()]).toEqual(["in.pdf"]);
        }
        expect(result.exitCode).toBe(input === damaged ? 99 : 0);
        if (input === damaged) {
          expect(result.stdout).toBe("");
          expect(result.stderr).toBe(quiet ? "" : "Command Line Error: Wrong page range given: the first page (1) can not be after the last page (0).\n");
        } else {
          expect(result.stderr).toBe("");
          expect(result.stdout).toBe(list ? "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n--------------------------------------------------------------------------------------------\n" : "");
        }
      }
    });
  }
}
