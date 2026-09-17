import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocument, createDocxInspectionCommandEngine, extractDocumentText, inspectDocument, writeArchive, type ArchiveContext } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
function zip64(input: Uint8Array): Uint8Array {
  const end = input.length - 22, old = new DataView(input.buffer, input.byteOffset, input.byteLength), bytes = new Uint8Array(input.length + 76);
  bytes.set(input.subarray(0, end)); bytes.set(input.subarray(end), end + 76);
  const view = new DataView(bytes.buffer);
  view.setUint32(end, 0x06064b50, true); view.setBigUint64(end + 4, 44n, true);
  view.setUint16(end + 12, 45, true); view.setUint16(end + 14, 45, true);
  view.setBigUint64(end + 24, BigInt(old.getUint16(end + 8, true)), true); view.setBigUint64(end + 32, BigInt(old.getUint16(end + 10, true)), true);
  view.setBigUint64(end + 40, BigInt(old.getUint32(end + 12, true)), true); view.setBigUint64(end + 48, BigInt(old.getUint32(end + 16, true)), true);
  view.setUint32(end + 56, 0x07064b50, true); view.setBigUint64(end + 64, BigInt(end), true); view.setUint32(end + 72, 1, true);
  view.setUint16(end + 84, 65535, true); view.setUint16(end + 86, 65535, true); view.setUint32(end + 88, 0xffffffff, true); view.setUint32(end + 92, 0xffffffff, true);
  return bytes;
}
async function fixture(strict: boolean, kind: "docx" | "dotx", compression: "store" | "deflate", extended: boolean) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const mainType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "docx" ? "document" : "template"}.main+xml`;
  const types = {
    "[Content_Types].xml": "application/xml", "_rels/.rels": "application/vnd.openxmlformats-package.relationships+xml",
    "reports/body.xml": mainType, "reports/_rels/body.xml.rels": "application/vnd.openxmlformats-package.relationships+xml", "audit/data.xml": "application/xml"
  };
  const parts = new Map(Object.entries({
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="${types["_rels/.rels"]}"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/reports/body.xml" ContentType="${mainType}"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="reports/body.xml"/></Relationships>`,
    "reports/body.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<!--original prolog--><n:document xmlns:n="${w}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:opaque" mc:Ignorable="x"><n:body><n:p><n:r><n:t>Original 海</n:t></n:r><!--retained--><?audit keep?><x:record x:value="inert"/></n:p></n:body></n:document>`,
    "reports/_rels/body.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    "audit/data.xml": '<a:records xmlns:a="urn:original:audit"><a:value>Keep exactly</a:value></a:records>'
  }).map(([name, xml]) => [name, encode(xml)]));
  const volume = Volume.fromJSON({ "/out": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/out", bytes); } }, { order: "input", compression }, textContext);
  const original = new Uint8Array(volume.readFileSync("/out") as Buffer), central = new DataView(original.buffer, original.byteOffset, original.byteLength).getUint32(original.length - 6, true);
  return { input: extended ? zip64(original) : original, parts, types, w, r, central };
}
async function cli(input: Uint8Array, args: string[], context: ArchiveContext) {
  const volume = Volume.fromJSON({ "/misleading.bin": Buffer.from(input), "/out": "", "/err": "" }); let reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: context.limits }).execute({ args: args.map(encode), cwd: "/", signal: context.signal, filesystem: { async readFile(path) { expect(path).toBe("/misleading.bin"); reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { [Symbol.asyncIterator]() { throw new Error("Unexpected stdin acquisition"); } }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
  expect(reads).toBe(1); expect(volume.readFileSync("/misleading.bin")).toEqual(Buffer.from(input));
  return { exit: result.exitCode, output: volume.readFileSync("/out", "utf8") as string, bytes: new Uint8Array(volume.readFileSync("/out") as Buffer), error: volume.readFileSync("/err", "utf8") as string };
}
async function shell(input: Uint8Array, args: string[], context: ArchiveContext) {
  const fs = new MemoryFileSystem(); await fs.writeFile("/misleading.bin", input);
  const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: context.limits }) })).exec('docx ' + args.map(word => "'" + word.split("'").join("'\\''") + "'").join(' ') + ' > /out');
  expect(result.stdout).toBe(''); expect(await fs.readFile('/misleading.bin')).toEqual(input);
  const bytes = await fs.readFile('/out');
  return { exit: result.exitCode, output: new TextDecoder().decode(bytes), bytes, error: result.stderr };
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const compression of ["store", "deflate"] as const) for (const extended of [false, true]) for (const route of ["model", "sdk", "cli", "shell"] as const) it(`admits ${kind} strict=${strict} ${compression} ZIP${extended ? 64 : 32} through ${route}`, async () => {
  const { input, parts, types, w, r } = await fixture(strict, kind, compression, extended), original = input.slice();
  if (route === "model") {
    const document = await Document(input, textContext);
    expect(String(document.part.partname)).toBe("/reports/body.xml"); expect(document.part.content_type).toBe(types["reports/body.xml"]); expect(document.part.element.namespace).toBe(w);
    expect(document.paragraphs.map(paragraph => paragraph.text)).toEqual(["Original 海"]);
    const volume = Volume.fromJSON({ "/out": "" });
    await document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    const output = new Uint8Array(volume.readFileSync("/out") as Buffer);
    expect(readPackage(output)).toEqual(parts); expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Original 海");
  } else {
    const execute = route === 'shell' ? shell : cli;
    const response = route !== "sdk" ? await execute(input, ["inspect", "/misleading.bin", "--json"], textContext) : null;
    if (response) expect(response.exit, response.output + response.error).toBe(0);
    const data = response ? JSON.parse(response.output).data : await inspectDocument(input, textContext);
    expect(data.kind).toBe(kind); expect(data.dialect).toBe(strict ? "strict" : "transitional"); expect(data.counts.paragraphs).toBe(1);
    expect(data.parts).toHaveLength(parts.size);
    for (const [name, bytes] of parts) expect(data.parts).toContainEqual({ name: "/" + name, contentType: types[name as keyof typeof types], bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(data.relationships).toContainEqual({ owner: "/", id: "main", type: `${r}/officeDocument`, target: "reports/body.xml", external: false });
    expect(data.features).toContainEqual(expect.objectContaining({ id: "F05", detected: true }));
    if (route === "sdk") {
      expect((await extractDocumentText(input, textContext)).text).toBe("Original 海");
      const memory = Volume.fromJSON({ '/copy': '' });
      await createDocument({ template: input }, { output: '-' }, { ...textContext, encoding: { order: 'input', compression }, stdout: { async write(bytes) { memory.appendFileSync('/copy', bytes); } } });
      expect(readPackage(new Uint8Array(memory.readFileSync('/copy') as Buffer))).toEqual(parts);
    } else {
      const text = await execute(input, ["text", "get", "/misleading.bin"], textContext); expect(text.exit, text.error).toBe(0); expect(text.output).toBe("Original 海");
      const copied = await execute(input, ['create', '--template', '/misleading.bin', '--output', '-'], textContext); expect(copied.exit, copied.error).toBe(0); expect(readPackage(copied.bytes)).toEqual(parts);
    }
  }
  expect(input).toEqual(original);
});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const compression of ["store", "deflate"] as const) for (const extended of [false, true]) for (const fault of ["encrypted", "multidisk", "crc", "archive-limit"] as const) for (const route of ["model", "sdk", "cli", "shell"] as const) it(`refuses ${fault} ${compression} ZIP${extended ? 64 : 32} through ${route}${strict || kind !== 'docx' ? '; ' + kind + ' strict=' + strict : ''}`, async () => {
  const { input, central } = await fixture(strict, kind, compression, extended), view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (fault === "encrypted") { view.setUint16(6, view.getUint16(6, true) | 1, true); view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true); }
  if (fault === "multidisk") view.setUint16(input.length - 18, 1, true);
  if (fault === "crc") { const bad = (view.getUint32(14, true) ^ 1) >>> 0; view.setUint32(14, bad, true); view.setUint32(central + 16, bad, true); }
  const original = input.slice(), context = fault === "archive-limit" ? { ...textContext, limits: { ...textContext.limits, maxArchiveBytes: input.length - 1 } } : textContext, code = fault === "archive-limit" ? "limit-exceeded" : "invalid-container";
  if (route === "model") await expect(Document(input, context)).rejects.toMatchObject({ code });
  else if (route === "sdk") await expect(inspectDocument(input, context)).rejects.toMatchObject({ code });
  else { const result = await (route === 'shell' ? shell : cli)(input, ["inspect", "/misleading.bin", "--json"], context); expect(result.exit).toBe(fault === "archive-limit" ? 4 : 1); expect(JSON.parse(result.output)).toMatchObject({ ok: false, data: null, affected: 0, locations: [], errors: [expect.objectContaining({ code })] }); }
  expect(input).toEqual(original);
});
