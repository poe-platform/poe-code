import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosString, dictSet } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli } from "./index.js";

for (const retained of [false, true]) {
  for (const existing of [false, true]) {
    for (const outputExists of [false, true]) {
      it(`rejects missing attachment (retained=${retained}, existing=${existing}, outputExists=${outputExists})`, async () => {
        const doc = PdfDocument.create(); doc.addPage();
        if (existing) dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "Names", cosDict({
          EmbeddedFiles: cosDict({ Names: cosArray([cosString("note"), cosDict({ F: cosString("note.txt") })]) })
        }));
        const input = doc.save(), previous = new Uint8Array([1, 2, 3]);
        const args = ["/in.pdf", "/out.pdf", ...(existing ? ["--remove-attachment=note"] : []), "--remove-attachment=absent"];
        if (retained) {
          const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
          if (outputExists) await fs.writeFile("/out.pdf", previous);
          const stderr: Uint8Array[] = [];
          const result = await createQpdfCommand().execute({ command: "qpdf", args, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() { assert.fail("unexpected stdout"); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
          assert.equal(result.exitCode, 2);
          assert.equal(Buffer.concat(stderr).toString(), "qpdf: attachment absent not found\n");
          if (outputExists) assert.deepEqual(await fs.readFile("/out.pdf"), previous);
          else await assert.rejects(fs.stat("/out.pdf"), { code: "ENOENT" });
          assert.deepEqual(await fs.readFile("/in.pdf"), input);
          assert.deepEqual(await fs.readdir("/scratch"), []);
        } else {
          const files = new Map([["/in.pdf", input]]);
          if (outputExists) files.set("/out.pdf", previous);
          assert.deepEqual(await runQpdfCli(args, files), { exitCode: 2, stdout: "", stderr: "qpdf: attachment absent not found\n" });
          assert.deepEqual(files.get("/out.pdf"), outputExists ? previous : undefined);
          assert.deepEqual(files.get("/in.pdf"), input);
        }
      });
    }
  }
}
