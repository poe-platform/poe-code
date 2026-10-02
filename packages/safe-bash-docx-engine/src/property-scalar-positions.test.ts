import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, DocumentXmlEditor, createDocxInspectionCommandEngine, editDocumentProperties, inspectDocumentProperties, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
const entries = [
  {key: "title", tag: "dc:title", before: "Old coast", after: "New dunes", value: "New dunes"},
  {key: "revision", tag: "cp:revision", before: "12", after: "24", value: 24},
  {key: "created", tag: "dt:created", before: "2026-01-02T03:04:06Z", after: "2026-02-03T04:05:07Z", value: "2026-02-03T04:05:07Z"}
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const entry of entries) for (const position of ["before", "middle", "after"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} retains ${position} comment/PI in core ${entry.key}; ${kind} strict=${strict}`, async () => {
  const enc = (s: string) => new TextEncoder().encode(s), dec = (b: Uint8Array) => new TextDecoder().decode(b), marker = '<!--keep--><?audit  spaced?>';
  const split = position === "before" ? 0 : position === "after" ? entry.before.length : 2;
  const scalar = entry.before.slice(0, split) + marker + entry.before.slice(split);
  const xml = `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dt="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><${entry.tag}${entry.key === "created" ? ' xsi:type="dt:W3CDTF"' : ''} xml:lang="en">${scalar}</${entry.tag}><!--sibling--></cp:coreProperties>`;
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name: "metadata/core.xml", type: "application/vnd.openxmlformats-package.core-properties+xml", bytes: xml}], relationships: [{owner: "/", id: "core", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "metadata/core.xml"}]}));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const fs = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {fs.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {fs.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(fs.readFileSync("/input") as Buffer);
  if (route === "model") {
    const model = await Document(input, chartContext), core = model.core_properties;
    if (entry.key === "created") core.created = new Date(entry.after); else if (entry.key === "revision") core.revision = entry.value; else core.title = entry.value;
    await model.save(sink);
  } else if (route === "sdk") await editDocumentProperties(input, {operation: "properties.set", name: entry.key, value: entry.value, output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {const memory = new MemoryFileSystem(); await memory.writeFile("/input", input); const result = await new Shell({fs: memory}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})).exec(`docx properties set /input --name ${entry.key} --value '${entry.after}' --output - > /output`); expect(result.exitCode, result.stderr).toBe(0); fs.writeFileSync("/output", await memory.readFile("/output")); expect(await memory.readFile("/input")).toEqual(input);}
  const output = new Uint8Array(fs.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(dec(saved.get("metadata/core.xml")!)).toBe(xml.replace(scalar, position === "before" ? marker + entry.after : entry.after + marker));
  expect((await inspectDocumentProperties(output, {name: entry.key}, chartContext)).items[0]!.properties[0]!.value).toBe(entry.value);
  for (const [name, bytes] of parts) if (name !== "metadata/core.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(fs.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const content of ['<!--keep--><?audit   retain?>', '<![CDATA[]]><!--keep--><?audit   retain?>', ''])
it(`replaces empty scalar text while preserving exact trivia ${JSON.stringify(content)}`, () => {
  const xml = `<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">${content}</dc:title>`, editor = new DocumentXmlEditor(new TextEncoder().encode(xml)), memory = Volume.fromJSON({"/output": ""});
  editor.replaceScalarText(editor.root, "New & dunes"); memory.writeFileSync("/output", editor.serialize());
  expect(memory.readFileSync("/output", "utf8")).toBe(xml.replace(content || "</dc:title>", content.startsWith("<![CDATA") ? 'New &amp; dunes<!--keep--><?audit   retain?>' : content ? content + "New &amp; dunes" : "New &amp; dunes</dc:title>"));
});
for (const content of ['<x:opaque xmlns:x="urn:original:unknown">keep</x:opaque>', '<dc:inner/>'])
it(`rejects nested scalar content without changing bytes ${JSON.stringify(content)}`, () => {
  const bytes = new TextEncoder().encode(`<dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Old${content}</dc:title>`), editor = new DocumentXmlEditor(bytes);
  expect(() => editor.replaceScalarText(editor.root, "New")).toThrow(); expect(editor.serialize()).toEqual(bytes);
});
