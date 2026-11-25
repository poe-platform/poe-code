import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { PdfDocument, cosDict, cosStream, cosName, cosNumber, dictGet, dictSet, dictDelete } from "@poe-code/pdf-ast";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const layout of ["shared", "shared-xobjects", "inherited"]) {
  for (const route of ["async", "sync", "command"]) {
    it(`preserves page-specific inline images and existing XObjects (${layout}, ${route})`, async () => {
      const doc = PdfDocument.create();
      const pages = [doc.addPage(), doc.addPage(), doc.addPage()];
      const existingPixels = Uint8Array.of(40, 50);
      const existing = doc.cos.allocateObject(cosStream(existingPixels, { dict: cosDict({
        Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(2),
        Height: cosNumber(1), BitsPerComponent: cosNumber(8), ColorSpace: cosName("DeviceGray"),
      }) }));
      const images = doc.cos.allocateObject(cosDict({ ImExt1: existing }));
      const resources = doc.cos.allocateObject(cosDict({ XObject: images }));
      const pagePixels = [Uint8Array.of(10, 20), Uint8Array.of(70, 80)];
      for (const [index, page] of pages.entries()) {
        page.setRawContentStream(index < 2 ? Buffer.concat([
          Buffer.from("/ImExt1 Do\nBI /W 2 /H 1 /BPC 8 /CS /G ID "),
          pagePixels[index]!, Buffer.from(" EI"),
        ]) : Buffer.from("/ImExt1 Do"));
        dictSet(page.dict, "Resources", layout === "shared-xobjects"
          ? doc.cos.allocateObject(cosDict({ XObject: images })) : resources);
        if (layout === "inherited") {
          dictSet(doc.cos.resolveDict(dictGet(page.dict, "Parent"))!, "Resources", resources);
          dictDelete(page.dict, "Resources");
        }
      }
      const input = doc.save();
      const args = ["in.pdf", "--externalize-inline-images", "--ii-min-bytes=2", "out.pdf"];
      let bytes: Uint8Array;
      if (route === "command") {
        const fs = createMemoryFileSystem();
        await fs.mkdir("/scratch");
        await fs.writeFile("/in.pdf", input);
        const carrier = createCommandArguments(args);
        const errors: Uint8Array[] = [];
        const result = await createQpdfCommand().execute({
          command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/",
          env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write(chunk) { errors.push(chunk); } },
        });
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.deepEqual(await fs.readFile("/in.pdf"), input);
        bytes = await fs.readFile("/out.pdf");
      } else {
        const files = new Map([["in.pdf", input]]);
        const result = await (route === "async" ? runQpdfCli : runQpdfCliSync)(args, files);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(files.get("in.pdf"), input);
        bytes = files.get("out.pdf")!;
      }
      const output = PdfDocument.load(bytes);
      for (const [index, page] of output.getPages().entries()) {
        const xobjects = output.cos.resolveDict(dictGet(page.getResourcesDict(), "XObject"))!;
        assert.equal(xobjects.entries.length, index < 2 ? 2 : 1, "page " + index);
        const names = [...Buffer.from(page.getRawContentStream()).toString().matchAll(/\/(\w+) Do/g)].map(match => match[1]!);
        assert.equal(names.length, index < 2 ? 2 : 1);
        for (const [image, name] of names.entries()) {
          const stream = output.cos.resolve(dictGet(xobjects, name));
          assert.ok(stream?.kind === "stream");
          assert.deepEqual(output.cos.decodeStream(stream), image === 0 ? existingPixels : pagePixels[index]);
        }
      }
    });
  }
}
