import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, editDocumentProperties, inspectDocumentProperties, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const scope of ["extended-scalar", "custom-scalar", "custom-value"] as const)
for (const carrier of ["choice", "fallback", "process", "ignored", "empty-choice"] as const)
for (const action of ["set", "remove"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${action} ${scope} with inner ${carrier}; ${kind} strict=${strict}`, async () => {
  const enc = (s: string) => new TextEncoder().encode(s), dec = (b: Uint8Array) => new TextDecoder().decode(b), group = scope === "extended-scalar" ? "extended" : "custom";
  const office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/";
  const empty = carrier === "empty-choice", before = empty ? "" : "Old coast", active = scope === "custom-value" ? empty ? '<v:lpwstr/>' : '<v:lpwstr>Old coast</v:lpwstr>' : before, inactive = scope === "custom-value" ? '<v:lpwstr>Inactive dunes</v:lpwstr>' : "Inactive dunes";
  const wrapped = carrier === "process" ? '<f:bridge>'+active+'</f:bridge>' : carrier === "ignored" ? '<f:opaque mc:MustUnderstand="f">'+inactive+'</f:opaque>'+active : '<mc:AlternateContent><mc:Choice Requires="f">'+inactive+'</mc:Choice>'+(carrier === "fallback" ? '<mc:Fallback>'+active+'</mc:Fallback>' : '<mc:Choice Requires="p">'+active+'</mc:Choice><mc:Fallback>'+inactive+'</mc:Fallback>')+'</mc:AlternateContent>';
  const inner = group === "extended" ? '<p:Company>'+wrapped+'</p:Company>' : '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Audit">'+(scope === "custom-value" ? wrapped : '<v:lpwstr>'+wrapped+'</v:lpwstr>')+'</p:property>';
  const xml = `<?audit before?><p:Properties xmlns:p="${office + (strict ? group + "Properties" : group + "-properties")}" xmlns:v="${office}docPropsVTypes" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:bridge">${inner}<!--retain--></p:Properties><?audit after?>`, name = `metadata/${group}.xml`, key = group === "extended" ? "extended:company" : "custom:Audit";
  const parts = readPackage(await chartFixture({strict, definitions: [], resources: [{name, type: `application/vnd.openxmlformats-officedocument.${group}-properties+xml;audit=coast`, bytes: xml}], relationships: [{owner: "/", id: "properties", type: office + "relationships/" + group + "-properties", target: name}]}));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await inspectDocumentProperties(input, {name: key}, chartContext)).items[0]!.properties[0]!.value).toBe(before);
  if (route === "sdk") {const pending = editDocumentProperties(input, action === "set" ? {operation: "properties.set", name: key, value: "New dunes", output: "-"} : {operation: "properties.remove", name: key, output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink}); if (action === "remove") await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); else await pending;}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})); const read = await shell.exec(`docx properties get /input --name ${key} --json`); expect(read.exitCode, read.stderr).toBe(0); expect(JSON.parse(read.stdout).data.item.properties[0].value).toBe(before); const result = await shell.exec(`docx properties ${action} /input --name ${key}${action === "set" ? " --value 'New dunes'" : ""} --output - > /output`); expect(result.exitCode, result.stderr).toBe(action === "remove" ? 1 : 0); if (action === "remove") expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
  if (action === "remove") {expect(memory.readFileSync("/output").length).toBe(0); return;}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  const expected = empty ? scope === "custom-value" ? xml.replace('<v:lpwstr/>', '<v:lpwstr>New dunes</v:lpwstr>') : xml.replace(group === "extended" ? '</p:Company>' : '</v:lpwstr>', group === "extended" ? 'New dunes</p:Company>' : 'New dunes</v:lpwstr>') : xml.replace("Old coast", "New dunes");
  expect(dec(saved.get(name)!)).toBe(expected);
  expect((await inspectDocumentProperties(output, {name: key}, chartContext)).items[0]!.properties[0]!.value).toBe("New dunes");
  memory.writeFileSync("/cleared", new Uint8Array());
  await editDocumentProperties(output, {operation: "properties.set", name: key, value: "", output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/cleared", bytes);}}});
  const cleared = new Uint8Array(memory.readFileSync("/cleared") as Buffer);
  expect(dec(readPackage(cleared).get(name)!)).toBe(expected.replace("New dunes", ""));
  expect((await inspectDocumentProperties(cleared, {name: key}, chartContext)).items[0]!.properties[0]!.value).toBe("");
  for (const [part, bytes] of parts) if (part !== name) expect(saved.get(part), part).toEqual(bytes);
});
