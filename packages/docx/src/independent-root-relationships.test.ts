import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentProperties, inspectDocument, inspectDocumentProperties, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
type Node = ReturnType<typeof xmlStructure>;
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const uppercase of [false, true]) for (const group of ["core", "extended", "custom"] as const) for (const route of (group === "core" ? ["model", "sdk", "sdk-batch", "shell", "batch-shell"] as const : ["sdk", "shell"] as const)) it(`${route} materializes ${group} properties retaining root relationship spelling; ${kind} strict=${strict} uppercase=${uppercase}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const root = uppercase ? "_RELS/.RELS" : "_rels/.rels";
  const parts = new Map(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/records/main.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + (kind === "docx" ? "document" : "template") + '.main+xml"/></Types>',
    [root]: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--original root--><Relationship Id="main" Type="' + r + '/officeDocument" Target="records/main.xml"/><Relationship Id="audit" Type="urn:original:audit" Target="audit.xml"/><Relationship Id="inert" Type="urn:original:external" Target="https://example.invalid/inert" TargetMode="External"/></Relationships>',
    "records/main.xml": '<w:document xmlns:w="' + w + '"><w:body><w:p><w:r><w:t>Original report</w:t></w:r></w:p></w:body></w:document>',
    "audit.xml": '<audit><!--untouched--><value>Original resource</value></audit>'
  }).map(([name, text]) => [name, encode(text)]));
  const memory = Volume.fromJSON({ "/zip": "", "/output": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(memory.readFileSync("/zip") as Buffer), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, timestamp: new Date("2026-01-02T03:04:05Z"), encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const before = await inspectDocument(input, textContext); expect(before.kind).toBe(kind); expect(before.dialect).toBe(strict ? "strict" : "transitional"); expect(before.relationships).toHaveLength(3); expect((await inspectDocumentProperties(input, {}, textContext)).items).toEqual([]);
  const name = group === "core" ? "core:title" : group === "extended" ? "extended:company" : "custom:Original", value = "Created property";
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.core_properties.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "properties" },
    { operation: "model.opc.coreprops.CoreProperties.title.set", receiver: { resultHandle: "properties" }, arguments: { value } }
  ] };
  if (route === "model") {
    const document = await Document(input, context); expect(document.part.package.rels.xml).toBe(new TextDecoder().decode(parts.get(root))); document.core_properties.title = value; await document.save(sink);
  } else if (route === "sdk-batch") { const document = await applyStyleModelBatch(input, batch, context); await document.save(sink); } else if (route === "sdk") await editDocumentProperties(input, { operation: "properties.set", name, value, ...(group === "custom" ? { type: "string" as const } : {}), output: "-" }, context);
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const inspection = await shell.exec("docx inspect /input --json"); expect(inspection.exitCode, inspection.stderr).toBe(0); expect(JSON.parse(inspection.stdout).data.relationships).toEqual(before.relationships);
    const command = route === "batch-shell" ? "batch --ops-file /ops.json --timestamp 2026-01-02T03:04:05Z" : "properties set --name " + name + " --value '" + value + "'" + (group === "custom" ? " --type string" : "");
    const result = await shell.exec("docx " + command + " /input --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect([...saved.keys()].filter(name => parts.has(name))).toEqual([...parts.keys()]); expect([...saved.keys()].filter(name => name.toLowerCase() === "_rels/.rels")).toEqual([root]);
  for (const [name, bytes] of parts) if (![root, "[Content_Types].xml"].includes(name)) expect(saved.get(name)).toEqual(bytes);
  const edges = nodes(xmlStructure(saved.get(root)!)).filter(n => n.name.endsWith("}Relationship")), original = nodes(xmlStructure(parts.get(root)!)).filter(n => n.name.endsWith("}Relationship"));
  expect(edges).toHaveLength(4); for (const edge of original) expect(edges).toContainEqual(edge); expect(new TextDecoder().decode(saved.get(root))).toContain("<!--original root-->");
  const properties = await inspectDocumentProperties(output, { name }, textContext); expect(properties.items).toHaveLength(1); expect(properties.items[0]!.properties[0]!.value).toBe(value);
  const document = await Document(output, textContext); expect(document.paragraphs[0]!.text).toBe("Original report"); if (group === "core") expect(document.core_properties.title).toBe(value);
  expect(memory.readFileSync("/zip")).toEqual(Buffer.from(input));
});
