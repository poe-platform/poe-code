import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PdfDocument, cosArray, cosDict, cosName, cosNumber, cosStream, extractDocumentImages} from "@poe-code/pdf-ast";
import {Jbig2Image} from "../../pdf-ast/src/vendor/pdfjs-image-decoders.mjs";
import {Shell, agentCommands, createMemoryFileSystem} from "@poe-platform/safe-bash";
import {RustWasmBash} from "./index.js";

const fixture = name => new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
const cases = [
  {name: "arithmetic generic", data: fixture("jbig2-generic-stream.bin")},
  {name: "MMR generic", data: fixture("jbig2-mmr-stream.bin")},
  {name: "global symbols", data: fixture("jbig2-symbols.0000"), globals: fixture("jbig2-symbols.sym")},
];
cases.push(...cases.map(entry => ({...entry, name: `${entry.name} stencil`, stencil: true})));
for (const transposed of [false, true]) for (const corner of [0, 1, 2, 3]) {
  const data = cases[2].data.slice(), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setUint16(59, (transposed ? 64 : 0) | (corner << 4) | (2 << 7) | 512);
  cases.push({name: `text XOR transposed=${transposed} corner=${corner}`, data, globals: cases[2].globals});
}
const regression = extractDocumentImages(PdfDocument.load(fixture("pdfjs-jbig2-symbol-offset.pdf")).cos)[0];
cases.push({name: "PDF.js symbol offset regression", data: regression.rawEncodedBytes, globals: regression.jbig2GlobalsBytes, width: regression.width, height: regression.height});
const pack = bits => {const out = new Uint8Array(Math.ceil(bits.length / 8)); for (let i = 0; i < bits.length; i++) if (bits[i] === "1") out[i >> 3] |= 128 >> (i & 7); return out;};
function segment(number, kind, refs, payload) {
  const head = new Uint8Array(11 + refs.length), view = new DataView(head.buffer);
  view.setUint32(0, number); head[4] = kind; head[5] = refs.length << 5; head.set(refs, 6);
  head[6 + refs.length] = 1; view.setUint32(7 + refs.length, payload.length);
  return Buffer.concat([head, payload]);
}
for (const compressed of [false, true]) for (const huffmanText of [false, true]) {
  const pixels = compressed ? pack("001" + "00110101" + "010") : Uint8Array.of(128);
  const coded = pack("0" + "10" + "111111" + "0" + pixels.length.toString(2).padStart(4, "0"));
  // A size of zero selects an uncompressed collective bitmap.
  if (!compressed) coded.set(pack("0" + "10" + "111111" + "00000"));
  const dict = new Uint8Array(10), dv = new DataView(dict.buffer);
  dv.setUint16(0, 1); dv.setUint32(2, 1); dv.setUint32(6, 1);
  const dictionary = Buffer.concat([dict, coded, pixels, pack("00000" + "00001")]);
  const region = new Uint8Array(huffmanText ? 25 : 39), rv = new DataView(region.buffer);
  rv.setUint32(0, 64); rv.setUint32(4, 32); rv.setUint16(17, huffmanText ? 17 : 16); rv.setUint32(huffmanText ? 21 : 19, 1);
  const idTable = pack(Array.from({length: 35}, (_, i) => i === 1 ? "0001" : "0000").join("") + "0");
  const payload = huffmanText ? Buffer.concat([region, idTable, pack("00" + "000000000" + "0" + "01")]) : region;
  cases.push({name: `Huffman dictionary compressed=${compressed} Huffman text=${huffmanText}`,
    data: Buffer.concat([cases[0].data.subarray(0, 30), segment(1, 0, [], dictionary), segment(2, 6, [1], payload)])});
}
for (const choice of ["normal", "lower", "upper", "OOB"]) {
  const count = 4, oob = choice === "OOB", low = oob ? 1 : 2;
  const table = new Uint8Array(9), tv = new DataView(table.buffer);
  table[0] = 6 + (oob ? 1 : 0); tv.setInt32(1, low); tv.setInt32(5, count + low);
  const lines = pack(("0011" + "0").repeat(count) + "0011" + "0011" + (oob ? "0011" : ""));
  const dh = choice === "lower" ? "100" + "0".repeat(32) : choice === "upper" ? "101" + "0".repeat(32) : "000";
  const coded = pack(oob ? "0" + "000" + "110" + "00000" : dh + "10" + "111111" + "00000");
  const rows = choice === "lower" || oob ? 1 : choice === "upper" ? count + low : low;
  const dict = new Uint8Array(10), dv = new DataView(dict.buffer);
  dv.setUint16(0, oob ? 49 : 13); dv.setUint32(2, 1); dv.setUint32(6, 1);
  const region = new Uint8Array(39), rv = new DataView(region.buffer);
  rv.setUint32(0, 64); rv.setUint32(4, 32); rv.setUint16(17, 16); rv.setUint32(19, 1);
  cases.push({name: `custom Huffman ${choice}`, data: Buffer.concat([cases[0].data.subarray(0, 30),
    segment(1, 53, [], Buffer.concat([table, lines])),
    segment(2, 0, [1], Buffer.concat([dict, coded, new Uint8Array(rows).fill(128), pack("00000" + "00001")])),
    segment(3, 6, [2], region)])});
}
{
  const height = 129, header = pack("11111" + (height - 76).toString(2).padStart(32, "0") + "1110000" + "110" + "111111" + "00000");
  const dictionary = new Uint8Array(10), dv = new DataView(dictionary.buffer);
  dv.setUint16(0, 1); dv.setUint32(2, 1); dv.setUint32(6, 2);
  const region = new Uint8Array(27 + height * 2 + 2), rv = new DataView(region.buffer);
  rv.setUint32(0, 64); rv.setUint32(4, height); rv.setUint16(17, 18); region.set([255, 128, 255, 255], 19); rv.setUint32(23, 1);
  let state = 3;
  for (let i = 27; i < region.length - 2; i++) {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; region[i] = state >>> 24;}
  region.set([255, 172], region.length - 2);
  const page = cases[0].data.slice(0, 30); new DataView(page.buffer, page.byteOffset, page.byteLength).setUint32(15, height);
  cases.push({name: "adaptive symbol refinement", height, data: Buffer.concat([page,
    segment(1, 0, [], Buffer.concat([dictionary, header, new Uint8Array(height).fill(180), Uint8Array.of(8, 64)])), segment(2, 6, [1], region)])});
}
for (const mmr of [false, true]) for (const template of [0, 1, 2, 3]) {
  const dict = Uint8Array.of(1, 2, 2, 0, 0, 0, 1, 0x23, 0xaf);
  const region = new Uint8Array(38), rv = new DataView(region.buffer);
  rv.setUint32(0, 10); rv.setUint32(4, 10); rv.setUint32(8, 3); rv.setUint32(12, 4);
  region[17] = (mmr ? 1 : 0) | (template << 1); rv.setUint32(18, 5); rv.setUint32(22, 7);
  rv.setInt32(26, -256); rv.setInt32(30, -256); rv.setUint16(34, 256);
  const payload = mmr ? pack("1111111" + "000000000001000000000001") : Uint8Array.from({length: 128}, (_, i) => (i * 37 + 81) % 255);
  cases.push({name: `halftone MMR=${mmr} template=${template}`,
    data: Buffer.concat([cases[0].data.subarray(0, 30), segment(1, 16, [], dict), segment(2, 22, [1], Buffer.concat([region, payload]))])});
}
{
  const dict = Uint8Array.of(1, 2, 2, 0, 0, 0, 3, 0x23, 0xaf);
  const region = new Uint8Array(38), rv = new DataView(region.buffer);
  rv.setUint32(0, 10); rv.setUint32(4, 10); rv.setUint32(8, 3); rv.setUint32(12, 4);
  region[17] = 1; rv.setUint32(18, 5); rv.setUint32(22, 7); rv.setUint16(34, 256);
  const end = "000000000001000000000001";
  const planes = Buffer.concat([pack("1111111" + end), pack("001001101010101" + "00011" + "11111" + end)]);
  cases.push({name: "halftone multiple MMR gray planes", data: Buffer.concat([cases[0].data.subarray(0, 30),
    segment(1, 16, [], dict), segment(2, 22, [1], Buffer.concat([region, planes]))])});
}
for (const template of [0, 1, 2, 3]) for (const prediction of [false, true]) {
  const at = template === 0 ? [3, 255, 253, 255, 2, 254, 254, 254] : [3, 255];
  const data = new Uint8Array(59 + at.length + 4096), view = new DataView(data.buffer);
  data.set(cases[0].data.subarray(0, 30));
  view.setUint32(30, 1); data[34] = 38; data[36] = 1; view.setUint32(37, 18 + at.length + 4096);
  view.setUint32(41, 64); view.setUint32(45, 32); data[58] = (template << 1) | (prediction ? 8 : 0);
  data.set(at, 59);
  for (let i = 59 + at.length; i < data.length; i++) data[i] = (i * 37 + 81) % 255;
  cases.push({name: `template ${template} prediction ${prediction}`, data});
}

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
          assert.deepEqual(Buffer.from(await fs.readFile(`/in${suffix}`)), Buffer.from(await fs.readFile(`/raw${suffix}`)), `${command}, inverted=${inverted}, chained=${chained}`);
        }
      }
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}

for (const runtime of ["TypeScript", "Rust"]) test(`${runtime} JBIG2 failures preserve existing output`, {skip: !WebAssembly.Suspending}, async () => {
  const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
  const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
  const fs = memory ?? shell.fs, sentinel = new TextEncoder().encode("keep output");
  try {
    await fs.mkdir("/scratch", {recursive: true});
    const truncated = cases[0].data.slice(0, 20), forward = cases[0].data.slice(); forward[60] = 3;
    for (const data of [truncated, forward]) {
      await fs.writeFile("/in.pdf", document(data, undefined, false, false, false));
      for (const command of ["pdftoppm -png -singlefile -r 72", "pdftocairo -png -singlefile -r 72", "pdfimages -png"]) {
        const destination = command.startsWith("pdfimages") ? "/out-000.png" : "/out.png";
        await fs.writeFile(destination, sentinel);
        const result = await shell.exec(`TMPDIR=/scratch ${command} /in.pdf /out`);
        assert.notEqual(result.exitCode, 0, `${command} rejected malformed image`);
        assert.deepEqual(await fs.readFile(destination), sentinel);
      }
    }
    await fs.writeFile("/in.pdf", document(cases[0].data, undefined, false, false, false));
    await fs.writeFile("/out.png", sentinel);
    await assert.rejects(shell.exec("TMPDIR=/scratch pdftoppm -png -singlefile -r 72 /in.pdf /out", {limits: {maxOutputBytes: 1}}), {name: "ShellLimitError", limit: "maxOutputBytes"});
    assert.deepEqual(await fs.readFile("/out.png"), sentinel);
    if (runtime === "Rust") assert.equal(shell._companion, null);
  } finally {await shell.dispose();}
});
