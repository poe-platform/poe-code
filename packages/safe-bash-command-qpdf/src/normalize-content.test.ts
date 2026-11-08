import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosStream, dictGet, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const contents = ["q\r\n1 0 0 1 0 0 cm\r\n0 0 10 10 re f\r\nQ", "q\r0 1 0 rg\r10 10 20 20 re\rf Q", "q\rBI /W 3 /H 1 /BPC 8 /CS /G ID \r\n\r EI\rQ"];
const normalized = ["q\n1 0 0 1 0 0 cm\n0 0 10 10 re f\nQ", "q\n0 1 0 rg\n10 10 20 20 re\nf Q", "q\nBI /W 3 /H 1 /BPC 8 /CS /G ID \r\n\r EI\nQ"];
for (const compressed of [false, true]) for (const path of ["buffered", "sync", "retained"]) for (const split of [false, true]) for (const normalize of [false, true]) {
  it(`${path} (compressed=${compressed}): ${normalize ? "normalizes" : "preserves"} CRLF and CR content in ${split ? "split" : "ordinary"} output`, async () => {
    const document = PdfDocument.create();
    for (const content of contents) {
      const page = document.addPage();
      const stream = document.cos.allocateObject(cosStream(new TextEncoder().encode(content), { compress: compressed }));
      dictSet(page.pageDict, "Contents", compressed ? cosArray([stream]) : stream);
    }
    const input = document.save(), files = new Map([["in.pdf", input]]);
    const args = ["in.pdf", `--normalize-content=${normalize ? "y" : "n"}`, ...(split ? ["--split-pages=1"] : []), "out.pdf"];
    const names = split ? ["out-1.pdf", "out-2.pdf", "out-3.pdf"] : ["out.pdf"];
    if (path === "retained") {
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
      const carrier = createCommandArguments(args), errors: Uint8Array[] = [];
      const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() { assert.fail("Unexpected stdout"); } }, stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } } });
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      for (const name of names) files.set(name, await fs.readFile(`/${name}`));
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else assert.equal((await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files)).exitCode, 0);
    const output = names.flatMap(name => {
      const document = PdfDocument.load(files.get(name)!);
      return document.getPages().map(page => {
        const contents = document.cos.resolve(dictGet(page.pageDict, "Contents"));
        const stream = contents?.kind === "array" ? document.cos.resolve(contents.items[0]) : contents;
        assert.equal(stream?.kind, "stream");
        if (stream?.kind !== "stream") throw new Error("Missing content stream");
        return document.cos.decodeStream(stream);
      });
    });
    assert.deepEqual(output, (normalize ? normalized : contents).map(content => new TextEncoder().encode(content)));
    assert.deepEqual(files.get("in.pdf"), input);
  });
}
