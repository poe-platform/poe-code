import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PdfDocument, decodePng, cosArray, cosDict, cosName, cosNumber, cosStream} from "@poe-code/pdf-ast";
import {Jbig2Image} from "../../pdf-ast/src/vendor/pdfjs-image-decoders.mjs";
import {Shell, agentCommands, createMemoryFileSystem} from "@poe-platform/safe-bash";
import {RustWasmBash} from "./index.js";

const fixture = name => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
const cases = [
  {name: "arithmetic generic", data: fixture("jbig2-generic-stream.bin")},
  {name: "MMR generic", data: fixture("jbig2-mmr-stream.bin")},
  {name: "global symbols", data: fixture("jbig2-symbols.0000"), globals: fixture("jbig2-symbols.sym")},
];
for (const entry of cases) entry.stencil = true;

function document(data, globals, raw, inverted, chained, width = 64, height = 32, stencil = false) {
  const doc = PdfDocument.create(), page = doc.addPage([width + 36, height + 48]);
  const params = globals ? cosDict({JBIG2Globals: doc.cos.allocateObject(cosStream(globals))}) : cosDict({});
  const fields = {Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(width), Height: cosNumber(height),
    BitsPerComponent: cosNumber(1), ColorSpace: cosName("DeviceGray")};
  if (stencil) fields.ImageMask = {kind: "boolean", value: true};
  if (!raw) {
    fields.Filter = chained ? cosArray([cosName("ASCIIHexDecode"), cosName("JBIG2Decode")]) : cosName("JBIG2Decode");
    fields.DecodeParms = chained ? cosArray([{kind: "null"}, params]) : params;
  }
  if (inverted) fields.Decode = cosArray([cosNumber(1), cosNumber(0)]);
  const encoded = !raw && chained ? new TextEncoder().encode(Buffer.from(data).toString("hex") + ">") : data;
  const image = doc.cos.allocateObject(cosStream(encoded, {dict: cosDict(fields)}));
  const key = page.ensureXObjectResource(image);
  page.setRawContentStream(`0.2 0.6 0.8 rg 0 0 ${width + 36} ${height + 48} re f 0.9 0.2 0.3 rg q ${width} 0 0 ${height} 13 17 cm /${key} Do Q`);
  return doc.save();
}

for (const runtime of ["TypeScript", "Rust"]) for (const entry of cases) {
  test(`${runtime} JBIG2 raster and decoded extraction: ${entry.name}`, {skip: !WebAssembly.Suspending}, async () => {
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      await fs.mkdir("/scratch", {recursive: true});
      const chunks = [entry.globals, entry.data].filter(Boolean).map(data => ({data, start: 0, end: data.length}));
      const black = new Jbig2Image().parseChunks(chunks);
      assert.ok(black.some(value => value !== 0), "fixture contains ink");
      const raw = Uint8Array.from(black, value => value ^ 255);
      for (const inverted of [false, true]) for (const chained of [false, true]) {
        await fs.writeFile("/in.pdf", document(entry.data, entry.globals, false, inverted, chained, entry.width, entry.height, entry.stencil));
        await fs.writeFile("/raw.pdf", document(raw, undefined, true, inverted, false, entry.width, entry.height, entry.stencil));
        for (const command of ["pdftoppm -png -singlefile -r 72", "pdftocairo -png -singlefile -r 72", "pdfimages -png", "pdfimages"]) {
          for (const input of ["in", "raw"]) {
            const result = await shell.exec(`TMPDIR=/scratch ${command} /${input}.pdf /${input}`);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          const suffix = command === "pdfimages" ? "-000.pbm" : command.startsWith("pdfimages") ? "-000.png" : ".png";
          const actual = await fs.readFile(`/in${suffix}`), expected = await fs.readFile(`/raw${suffix}`);
          assert.deepEqual(suffix.endsWith("png") ? decodePng(actual) : actual, suffix.endsWith("png") ? decodePng(expected) : expected, `${command}, inverted=${inverted}, chained=${chained}`);
        }
      }
      const native = await shell.exec("TMPDIR=/scratch pdfimages -jbig2 /in.pdf /native");
      assert.equal(native.exitCode, 0, native.stderr);
      assert.deepEqual(await fs.readFile("/native-000.jb2e"), entry.data);
      if (entry.globals) assert.deepEqual(await fs.readFile("/native-000.jb2g"), entry.globals);
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}
