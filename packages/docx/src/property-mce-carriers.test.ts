import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentProperties, inspectDocument, inspectDocumentProperties, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const group of ["extended", "custom"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "ignored"] as const)
for (const action of ["set", "remove"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${action} selected ${group} property in ${carrier}; ${kind} strict=${strict}`, async () => {
  const enc = (s: string) => new TextEncoder().encode(s), dec = (b: Uint8Array) => new TextDecoder().decode(b);
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const inner = group === "extended" ? '<p:Company>Old coast</p:Company>' : '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Audit"><v:lpwstr>Old coast</v:lpwstr></p:property>';
  const inactive = inner.replace("Old coast", "Inactive dunes");
  const body = carrier === "direct" ? inner : carrier === "ignored" ? '<f:opaque mc:MustUnderstand="f">'+inactive+'</f:opaque>'+inner : carrier === "process" ? '<f:bridge>'+inner+'</f:bridge>' : '<mc:AlternateContent><mc:Choice Requires="f">'+inactive+'</mc:Choice>'+(carrier === "choice" ? '<mc:Choice Requires="p">'+inner+'</mc:Choice><mc:Fallback>'+inactive+'</mc:Fallback>' : '<mc:Fallback>'+inner+'</mc:Fallback>')+'</mc:AlternateContent>';
  const xml = `<?audit before?><p:Properties xmlns:p="${office + (strict ? group + "Properties" : group + "-properties")}" xmlns:v="${office}docPropsVTypes" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:bridge">${body}<!--retain--></p:Properties><?audit after?>`, name = `metadata/${group}.xml`, key = group === "extended" ? "extended:company" : "custom:Audit";
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name, type: `application/vnd.openxmlformats-officedocument.${group}-properties+xml;audit=relationships+xml`, bytes: xml}], relationships: [{owner: "/", id: "properties", type: office + "relationships/" + group + "-properties", target: name}]}));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await inspectDocumentProperties(input, {name: key}, chartContext)).items[0]!.properties[0]!.value).toBe("Old coast");
  expect((await inspectDocument(input, chartContext)).properties.filter(p => p.group === group).map(p => p.value)).toEqual(["Old coast"]);
  if (route === "sdk") await editDocumentProperties(input, action === "set" ? {operation: "properties.set", name: key, value: "New dunes", output: "-"} : {operation: "properties.remove", name: key, output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink});
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})); const read = await shell.exec(`docx properties get /input --name ${key} --json`); expect(read.exitCode, read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.item.properties[0].value).toBe("Old coast"); const result = await shell.exec(`docx properties ${action} /input --name ${key}${action === "set" ? " --value 'New dunes'" : ""} --output - > /output`); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(dec(saved.get(name)!)).toBe(action === "set" ? xml.replace("Old coast", "New dunes") : xml.replace(inner, ""));
  const properties = await inspectDocumentProperties(output, {}, chartContext); expect(properties.items.some(p => p.name === key)).toBe(action === "set"); if (action === "set") expect(properties.items.find(p => p.name === key)!.properties[0]!.value).toBe("New dunes");
  for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes);
  expect((await Document(output, chartContext)).paragraphs[0]!.text).toBe("coast"); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
