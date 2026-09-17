import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, readArchive, replaceDocumentXmlPart, validateDocumentArchive, writeArchive } from "./index.js";
import { DocumentPackage } from "./package.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const)
it(`rejects inserted core MCE before publication and retains namespace-only XML; ${kind} strict=${strict} ${encoding}`, async () => {
  const encode = (text: string): Uint8Array => {
    if (encoding === "UTF-8") return new TextEncoder().encode(text);
    if (encoding === "UTF-8-BOM") return new Uint8Array(Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)]));
    const bytes = new Uint8Array(text.length * 2 + 2), view = new DataView(bytes.buffer), little = encoding === "UTF-16LE";
    view.setUint16(0, 0xfeff, little);
    for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), little);
    return bytes;
  };
  const cp = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties", dc = "http://purl.org/dc/elements/1.1/", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const source = `<?xml version="1.0" encoding="${encoding.startsWith("UTF-8") ? "UTF-8" : encoding}"?><?audit retained?><cp:coreProperties xmlns:cp="${cp}" xmlns:dc="${dc}" xmlns:x="${mc}"><dc:title>Coast</dc:title><!--retained--></cp:coreProperties>`;
  const original = encode(source), replacement = encode(source.replace("<dc:title>", '<dc:title x:MustUnderstand="dc">'));
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name: "metadata/core.xml", type: "Application/Vnd.OpenXmlFormats-Package.Core-Properties+Xml", bytes: original}], relationships: [{owner: "/", id: "core", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "metadata/core.xml"}]}));
  parts.set("[Content_Types].xml", new TextEncoder().encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": "", "/model": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), archive = await readArchive(input, chartContext);
  expect(new DocumentPackage(archive, chartContext.limits).getPart("/metadata/core.xml").bytes).toEqual(original);
  const candidate = {...archive, members: archive.members.map(member => member.name === "metadata/core.xml" ? {...member, bytes: replacement} : member)};
  expect(() => new DocumentPackage(candidate, chartContext.limits)).toThrowError(expect.objectContaining({code: "invalid-package", part: "/metadata/core.xml"}));
  const report = validateDocumentArchive(candidate); expect(report.valid).toBe(false); expect(report.diagnostics.some(row => row.part === "/metadata/core.xml")).toBe(true);
  for (const dryRun of [false, true]) await expect(replaceDocumentXmlPart(input, replacement, {part: "/metadata/core.xml", ...(dryRun ? {dryRun} : {output: "-"})}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink})).rejects.toMatchObject({code: "invalid-package"});
  expect(memory.readFileSync("/output").length).toBe(0);
  const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement", replacement);
  const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
  const rejected = await shell.exec("docx xml set /input --part /metadata/core.xml --file /replacement --dry-run --json");
  expect(rejected.exitCode).toBe(1); expect(JSON.parse(rejected.stdout).errors[0].code).toBe("invalid-package");
  const binary = await shell.exec("docx xml set /input --part /metadata/core.xml --file /replacement --output - > /rejected");
  expect(binary.exitCode).toBe(1); expect((await fs.readFile("/rejected")).length).toBe(0);
  const model = await Document(input, chartContext); model.add_paragraph("Dunes"); await model.save({async write(bytes) {memory.appendFileSync("/model", bytes);}});
  const saved = readPackage(new Uint8Array(memory.readFileSync("/model") as Buffer)); for (const [name, bytes] of parts) if (name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  await replaceDocumentXmlPart(input, encode(source.replace("Coast", "Dunes")), {part: "/metadata/core.xml", output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  const edited = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)); expect(edited.get("metadata/core.xml")).toEqual(encode(source.replace("Coast", "Dunes"))); for (const [name, bytes] of parts) if (name !== "metadata/core.xml") expect(edited.get(name), name).toEqual(bytes);
  expect(await fs.readFile("/input")).toEqual(input); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
