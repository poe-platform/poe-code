import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

const globals = readFileSync(new URL("../../pdf-ast/src/fixtures/jbig2-symbols.sym", import.meta.url));
const pageBytes = readFileSync(new URL("../../pdf-ast/src/fixtures/jbig2-symbols.0000", import.meta.url));
const generic = readFileSync(new URL("../../pdf-ast/src/fixtures/jbig2-generic-stream.bin", import.meta.url));
for (const runtime of ["TypeScript", "Rust"]) for (const chained of [false, true]) for (const pageNumbers of [false, true]) {
  test(`${runtime} pdfimages preserves JBIG2 sidecars chained=${chained} pages=${pageNumbers}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      await fs.mkdir("/scratch", {recursive: true});
      for (const flag of ["-all", "-jbig2"]) {
        const doc = PdfDocument.create(); doc.addPage([100, 100]); const page = doc.addPage([100, 100]);
        const globalRef = doc.cos.allocateObject(cosStream(globals));
        const params = cosDict({JBIG2Globals: globalRef});
        const image = doc.cos.allocateObject(cosStream(chained ? new TextEncoder().encode(pageBytes.toString("hex") + ">") : pageBytes, {
          dict: cosDict({Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(64), Height: cosNumber(32),
            BitsPerComponent: cosNumber(1), ColorSpace: cosName("DeviceGray"),
            Filter: chained ? cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]) : cosName("JBIG2Decode"),
            DecodeParms: chained ? cosArray([{kind: "null"}, params]) : params}),
        }));
        const key = page.ensureXObjectResource(image); page.setRawContentStream(`q 64 0 0 32 10 10 cm /${key} Do Q`);
        await fs.writeFile("/in.pdf", doc.save());
        const result = await shell.exec(`TMPDIR=/scratch pdfimages ${flag} -f 2 -l 2 ${pageNumbers ? "-p" : ""} -print-filenames /in.pdf /image`);
        assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
        const base = pageNumbers ? "/image-002-000" : "/image-000";
        assert.equal(result.stdout, `${base}.jb2e\n`);
        assert.deepEqual(Buffer.from(await fs.readFile(`${base}.jb2e`)), pageBytes);
        assert.deepEqual(Buffer.from(await fs.readFile(`${base}.jb2g`)), globals);
        const list = await shell.exec("TMPDIR=/scratch pdfimages -list /in.pdf");
        assert.equal(list.exitCode, 0, list.stderr); assert.match(list.stdout, /jbig2/);
        await fs.writeFile(`${base}.jb2e`, new TextEncoder().encode("keep image"));
        await fs.writeFile(`${base}.jb2g`, new TextEncoder().encode("keep globals"));
        await assert.rejects(shell.exec(`TMPDIR=/scratch pdfimages ${flag} ${pageNumbers ? "-p" : ""} /in.pdf /image`, {limits: {maxOutputBytes: 1}}), {name: "ShellLimitError", limit: "maxOutputBytes"});
        assert.equal(Buffer.from(await fs.readFile(`${base}.jb2e`)).toString(), "keep image");
        assert.equal(Buffer.from(await fs.readFile(`${base}.jb2g`)).toString(), "keep globals");
      }
      const doc = PdfDocument.create(), page = doc.addPage([100, 100]);
      const image = doc.cos.allocateObject(cosStream(generic, {dict: cosDict({Type: cosName("XObject"), Subtype: cosName("Image"),
        Width: cosNumber(64), Height: cosNumber(32), BitsPerComponent: cosNumber(1), ColorSpace: cosName("DeviceGray"), Filter: cosName("JBIG2Decode")})}));
      const key = page.ensureXObjectResource(image); page.setRawContentStream(`q 64 0 0 32 10 10 cm /${key} Do Q`);
      await fs.writeFile("/generic.pdf", doc.save());
      const result = await shell.exec("TMPDIR=/scratch pdfimages -jbig2 -print-filenames /generic.pdf /generic");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "/generic-000.jb2e\n");
      assert.deepEqual(Buffer.from(await fs.readFile("/generic-000.jb2e")), generic);
      assert.equal((await shell.exec("test ! -e /generic-000.jb2g")).exitCode, 0);
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}
