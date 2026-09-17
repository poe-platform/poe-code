import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine, editDocumentProperties, inspectDocumentProperties, parseDocumentXml, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["ignored", "choice"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} reserves inactive custom property IDs in ${carrier}; ${kind} strict=${strict}`, async () => {
  const enc = (s: string) => new TextEncoder().encode(s), dec = (b: Uint8Array) => new TextDecoder().decode(b), office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const hidden = '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Hidden"><v:lpwstr>Retained</v:lpwstr></p:property>', active = '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="3" name="Active"><v:lpwstr>Coast</v:lpwstr></p:property>';
  const body = carrier === "ignored" ? '<f:opaque>'+hidden+'</f:opaque>'+active : '<mc:AlternateContent><mc:Choice Requires="f">'+hidden+'</mc:Choice><mc:Fallback>'+active+'</mc:Fallback></mc:AlternateContent>';
  const xml = `<p:Properties xmlns:p="${office + (strict ? "customProperties" : "custom-properties")}" xmlns:v="${office}docPropsVTypes" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f">${body}<!--retain--></p:Properties>`;
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name: "metadata/custom.xml", type: "application/vnd.openxmlformats-officedocument.custom-properties+xml", bytes: xml}], relationships: [{owner: "/", id: "custom", type: office + "relationships/custom-properties", target: "metadata/custom.xml"}]}));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") await editDocumentProperties(input, {operation: "properties.set", name: "custom:New", type: "string", value: "Dunes", output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})).exec("docx properties set /input --name custom:New --type string --value Dunes --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), source = dec(saved.get("metadata/custom.xml")!), root = parseDocumentXml(saved.get("metadata/custom.xml")!).root;
  const added = root.children.find(node => node.attributes.some(a => a.localName === "name" && a.value === "New"))!;
  expect(added.attributes.find(a => a.localName === "pid")!.value).toBe("4"); expect(source).toContain(body+'<!--retain-->');
  expect((await inspectDocumentProperties(output, {name: "custom:New"}, chartContext)).items[0]!.properties[0]!.value).toBe("Dunes");
  for (const [name, bytes] of parts) if (name !== "metadata/custom.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
