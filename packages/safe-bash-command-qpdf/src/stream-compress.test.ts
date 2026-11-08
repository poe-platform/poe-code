import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosStream, decodeStreamObject, dictGet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

const input = readFileSync(new URL("../../pdf-ast/src/fixtures/qpdf-shared-images.pdf", import.meta.url));
const original = PdfDocument.load(input);
const imagePayloads = [...original.cos.objects.values()].flatMap(object => object.value.kind === "stream" && dictGet(object.value.dict, "Subtype")?.kind === "name" ? [Buffer.from(decodeStreamObject(object.value)).toString("base64")] : []);
const encodedDocument = PdfDocument.load(input);
for (const [number, object] of encodedDocument.cos.objects) {
  if (object.value.kind === "stream" && !dictGet(object.value.dict, "Filter")) encodedDocument.cos.objects.set(number, { ...object, value: cosStream(object.value.rawBytes, { dict: object.value.dict, compress: true }) });
}
const encodedInput = encodedDocument.save();
for (const encoded of [false, true]) for (const path of ["buffered", "sync", "retained"]) for (const mode of ["default", "compress", "preserve", "uncompress"]) for (const split of [false, true]) {
  if (encoded && mode === "uncompress") continue;
  it(`${path}: ${mode} image streams (split=${split}, encoded=${encoded})`, async () => {
    const source = encoded ? encodedInput : input;
    const files = new Map<string, Uint8Array>([["in.pdf", source]]);
    const args = ["in.pdf", "out.pdf", ...(mode === "default" ? [] : [`--stream-data=${mode}`]), ...(split ? ["--split-pages=5"] : [])];
    if (path === "retained") {
      const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", source);
      const carrier = createCommandArguments(args);
      const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() { assert.fail("stdout"); } }, stderr: { async write() { assert.fail("stderr"); } } });
      assert.equal(result.exitCode, 0);
      for (const name of split ? ["out-01-05.pdf", "out-06-10.pdf"] : ["out.pdf"]) files.set(name, await fs.readFile(`/${name}`));
      assert.deepEqual(await fs.readdir("/scratch"), []);
    } else assert.equal((await (path === "sync" ? runQpdfCliSync : runQpdfCli)(args, files)).exitCode, 0);
    let pageIndex = 0;
    for (const name of split ? ["out-01-05.pdf", "out-06-10.pdf"] : ["out.pdf"]) {
      const bytes = files.get(name)!, output = PdfDocument.load(bytes);
      assert.equal(output.getPageCount(), split ? 5 : 10);
      for (const page of output.getPages()) assert.deepEqual(page.getContentAst(), original.getPages()[pageIndex++]!.getContentAst());
      const images = [...output.cos.objects.values()].filter(object => object.value.kind === "stream" && dictGet(object.value.dict, "Subtype")?.kind === "name" && (dictGet(object.value.dict, "Subtype") as { decoded: string }).decoded === "Image");
      assert.ok(images.length > 0);
      for (const object of images) {
        if (object.value.kind !== "stream") assert.fail("stream");
        const compressed = encoded || mode === "default" || mode === "compress";
        const filter = dictGet(object.value.dict, "Filter");
        assert.equal(filter?.kind === "name" ? filter.decoded : undefined, compressed ? "FlateDecode" : undefined);
        assert.equal(object.value.rawBytes.length < 100, compressed);
        assert.ok(imagePayloads.includes(Buffer.from(decodeStreamObject(object.value)).toString("base64")));
      }
      if (mode === "default" || mode === "compress") assert.ok(bytes.length < (split ? 10000 : 15000));
    }
  });
}
