import assert from "node:assert/strict";
import { it } from "node:test";
import { PdfDocument, cosArray, cosBool, cosDict, cosName, cosNumber, cosStream, cosString, dictSet, dictGet, dictDelete } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

for (const version of [1, 2]) for (const mode of ["basic", "metadata", "compressed", "name", "name-tree", "action", "mask", "inherited"]) it(`matches native JSON ${version} pages (${mode})`, async () => {
  const rich = mode !== "basic";
  const doc = PdfDocument.create(), page = doc.addPage(); page.drawText("hello", { x: 10, y: 20 }); doc.addPage();
  if (rich) {
    const root = doc.cos.resolveDict(doc.cos.rootRef)!;
    dictSet(root, "PageLabels", cosDict({ Nums: cosArray([cosNumber(0), cosDict({ S: cosName("r"), P: cosString("π"), St: cosNumber(4) })]) }));
    const dest = cosArray([page.ref, cosName("Fit")]);
    if (mode === "name") dictSet(root, "Dests", cosDict({ chapter: dest }));
    if (mode === "name-tree") dictSet(root, "Names", cosDict({ Dests: cosDict({ Names: cosArray([cosString("chapter"), dest]) }) }));
    const outline = doc.cos.allocateObject(cosDict({ Title: cosString("chapter"), ...(mode === "action" ? { A: cosDict({ S: cosName("GoTo"), D: dest }) } : { Dest: mode === "name" ? cosName("chapter") : mode === "name-tree" ? cosString("chapter") : dest }) }));
    dictSet(root, "Outlines", cosDict({ First: outline }));
    const image = cosStream(new Uint8Array([255, 0, 0]), { compress: mode === "compressed" });
    for (const [key, value] of Object.entries({ Subtype: cosName("Image"), Width: cosNumber(1), Height: cosNumber(1), ColorSpace: cosName("DeviceRGB"), BitsPerComponent: cosNumber(8) })) dictSet(image.dict, key, value);
    if (mode === "mask") dictSet(image.dict, "ImageMask", cosBool(true));
    dictSet(page.dict, "Resources", cosDict({ XObject: cosDict({ Im: doc.cos.allocateObject(image) }) }));
  }
  if (mode === "inherited") {
    dictSet(doc.cos.resolveDict(dictGet(page.dict, "Parent"))!, "Resources", dictGet(page.dict, "Resources")!);
    dictDelete(page.dict, "Resources");
  }
  const input = doc.save(), args = [`--json=${version}`, "--json-key=pages", "in.pdf"];
  const ref = (node: { objectNumber: number; generationNumber: number }) => `${node.objectNumber} ${node.generationNumber} R`;
  const expected = { version, parameters: { decodelevel: "generalized" }, pages: doc.getPages().map((pg, index) => ({
    contents: [ref(dictGet(pg.dict, "Contents") as { objectNumber: number; generationNumber: number })],
    images: rich && mode !== "mask" && index === 0 ? [{ bitspercomponent: 8, colorspace: "/DeviceRGB", decodeparms: [null], filter: [mode === "compressed" ? "/FlateDecode" : null], filterable: true, height: 1, name: "/Im", object: `${doc.cos.maxObjectNumber} 0 R`, width: 1 }] : [],
    label: rich ? { "/P": version === 1 ? "π" : "u:π", "/S": "/r", "/St": 4 + index } : null,
    object: ref(pg.ref), outlines: rich && index === 0 ? [{ dest: [ref(page.ref), "/Fit"], object: `${doc.cos.maxObjectNumber - 1} 0 R`, title: "chapter" }] : [], pageposfrom1: index + 1
  })) };
  assert.deepEqual(JSON.parse(runQpdfCliSync(args, new Map([["in.pdf", input]])).stdout), expected);
  const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
  assert.equal(buffered.exitCode, 0); assert.deepEqual(JSON.parse(buffered.stdout), expected);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const stdout: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()), expected);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
