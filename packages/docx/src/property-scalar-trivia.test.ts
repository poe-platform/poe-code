import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentProperties, inspectDocument, inspectDocumentProperties, writeArchive, type DocxBatchOperation } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { fidelityBytes, type FidelityEncoding } from "../tests/fixtures/xml-fidelity.js";
import { readPackage } from "../tests/assertions.js";

async function fixture(strict: boolean, kind: "docx" | "dotx", group: "core" | "extended" | "custom", encoding: FidelityEncoding, trivia: boolean) {
  const enc = (value: string) => new TextEncoder().encode(value), dec = (value: Uint8Array) => new TextDecoder().decode(value);
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const scalar = trivia ? "Old<!--scalar comment--><![CDATA[ coast]]><?audit scalar?> 海" : "Old coast 海";
  const inner = group === "core" ? `<dc:title xml:space="preserve">${scalar}</dc:title>` : group === "extended" ? `<p:Company xml:space="preserve">${scalar}</p:Company>` : `<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Audit"><v:lpwstr xml:space="preserve">${scalar}</v:lpwstr></p:property>`;
  const namespace = group === "core" ? "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" : office + (strict ? group + "Properties" : group + "-properties");
  const tag = group === "core" ? "coreProperties" : "Properties";
  const source = `<?xml version="1.0" encoding="${encoding.startsWith("UTF-8") ? "UTF-8" : group === "core" ? "UTF-16" : encoding}"?><!--prolog--><p:${tag} xmlns:p="${namespace}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:v="${office}docPropsVTypes">${inner}<!--sibling--></p:${tag}><?audit epilog?>`;
  const parts = readPackage(await textFixture('<w:p><w:r><w:t>Body retained</w:t></w:r></w:p>', {}, strict)), name = `docProps/${group}.data`;
  parts.set(name, fidelityBytes(source, encoding));
  const type = group === "core" ? "application/vnd.openxmlformats-package.core-properties+xml" : `application/vnd.openxmlformats-officedocument.${group}-properties+xml;audit=coast`;
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`).replace("</Types>", `<Override PartName="/${name}" ContentType="${type}"/></Types>`)));
  parts.set("_rels/.rels", enc(dec(parts.get("_rels/.rels")!).replace("</Relationships>", `<Relationship Id="metadata" Type="${group === "core" ? "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" : office + "relationships/" + group + "-properties"}" Target="${name}"/></Relationships>`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""});
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) { memory.appendFileSync("/input", bytes); }}, {order: "input", compression: "store"}, textContext);
  return {input: new Uint8Array(memory.readFileSync("/input") as Buffer), memory, parts, name, source, inner, scalar, key: group === "core" ? "core:title" : group === "extended" ? "extended:company" : "custom:Audit"};
}

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const)
for (const group of ["core", "extended", "custom"] as const) for (const trivia of [false, true])
for (const action of ["set", "remove"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${action} preserves ${group} scalar XML trivia=${trivia} encoding=${encoding}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, group, encoding, trivia), sink = {async write(bytes: Uint8Array) {f.memory.appendFileSync("/output", bytes);}};
  const inspected = await inspectDocumentProperties(f.input, {name: f.key}, textContext);
  expect(inspected.items[0]!.properties[0]!.value).toBe("Old coast 海");
  expect((await inspectDocument(f.input, textContext)).properties.find(p => p.group === group && p.name === f.key.split(":")[1])!.value).toBe("Old coast 海");
  if (route === "sdk") await editDocumentProperties(f.input, action === "set" ? {operation: "properties.set", name: f.key, value: "New dunes 🌊", output: "-"} : {operation: "properties.remove", name: f.key, output: "-"}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const read = await shell.exec(`docx properties get /input --name ${f.key} --json`); expect(read.exitCode, read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.item.properties[0].value).toBe("Old coast 海");
    const result = await shell.exec(`docx properties ${action} /input --name ${f.key}${action === "set" ? " --value 'New dunes 🌊'" : ""} --output - > /output`); expect(result.exitCode, result.stderr).toBe(0);
    f.memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(f.input);
  }
  const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  const next = action === "remove" ? f.source.replace(f.inner, "") : f.source.replace(f.scalar, trivia ? "New dunes 🌊<!--scalar comment--><?audit scalar?>" : "New dunes 🌊");
  expect(saved.get(f.name)).toEqual(fidelityBytes(next, encoding));
  const properties = await inspectDocumentProperties(output, {}, textContext);
  expect(properties.items.some(p => p.name === f.key)).toBe(action === "set");
  if (action === "set") expect(properties.items.find(p => p.name === f.key)!.properties[0]!.value).toBe("New dunes 🌊");
  for (const [name, bytes] of f.parts) if (name !== f.name) expect(saved.get(name), name).toEqual(bytes);
  expect((await Document(output, textContext)).paragraphs[0]!.text).toBe("Body retained"); expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const encoding of ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] as const)
for (const trivia of [false, true]) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} core model setter replaces complete scalar trivia=${trivia} encoding=${encoding}; ${kind} strict=${strict}`, async () => {
  const f = await fixture(strict, kind, "core", encoding, trivia), sink = {async write(bytes: Uint8Array) {f.memory.appendFileSync("/output", bytes);}};
  const operations: DocxBatchOperation[] = [
    {operation: "model.document.Document.core_properties.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "core"},
    {operation: "model.opc.coreprops.CoreProperties.title.set", receiver: {resultHandle: "core"}, arguments: {value: "New dunes 🌊"}}
  ];
  if (route === "model") {const model = await Document(f.input, textContext); model.core_properties.title = "New dunes 🌊"; expect(model.core_properties.title).toBe("New dunes 🌊"); await model.save(sink);}
  else if (route === "sdk") await (await applyStyleModelBatch(f.input, {version: 1, operations}, textContext)).save(sink);
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", f.input); await fs.writeFile("/ops.json", new TextEncoder().encode(JSON.stringify({version: 1, operations}))); const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx batch /input --ops-file /ops.json --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); f.memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(f.input);}
  const output = new Uint8Array(f.memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(saved.get(f.name)).toEqual(fidelityBytes(f.source.replace(f.scalar, trivia ? "New dunes 🌊<!--scalar comment--><?audit scalar?>" : "New dunes 🌊"), encoding));
  expect((await Document(output, textContext)).core_properties.title).toBe("New dunes 🌊");
  for (const [name, bytes] of f.parts) if (name !== f.name) expect(saved.get(name), name).toEqual(bytes);
  expect(f.memory.readFileSync("/input")).toEqual(Buffer.from(f.input));
});
