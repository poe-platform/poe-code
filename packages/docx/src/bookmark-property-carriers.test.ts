import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createDocxInspectionCommandEngine, editDocumentBookmarks, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const group of ["extended", "custom"] as const) for (const native of [false, true])
for (const carrier of ["direct", "comment", "choice", "fallback", "process", "ignored", "nested", "name", "prefix", "unknown-attribute", "opaque-host", "nested-process"] as const)
for (const route of ["sdk", "shell"] as const) {
 if (carrier === "name" && group === "extended") continue;
 it(`${route} preserves ${native ? "native" : "generic"} ${group} bookmark literal in ${carrier}; ${kind} strict=${strict}`, async () => {
  const enc = (s: string) => new TextEncoder().encode(s), dec = (b: Uint8Array) => new TextDecoder().decode(b), office = strict ? "http://purl.oclc.org/ooxml/officeDocument/" : "http://schemas.openxmlformats.org/officeDocument/2006/", r = office + "relationships";
  const property = (text: string) => group === "extended" ? '<p:Company>'+text+'</p:Company>' : '<p:property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="'+(carrier === "name" ? "Coast" : "Audit")+'"><v:lpwstr>'+text+'</v:lpwstr></p:property>';
  const value = carrier === "comment" ? 'Original Co<!--retain--><![CDATA[ast]]>' : "Original Coast", active = property(value), other = property("Other");
  const body = carrier === "nested-process" ? property("<f:bridge>"+value+"</f:bridge>") : carrier === "opaque-host" ? '<f:active xmlns:f="urn:original:active">'+active+'</f:active>' : carrier === "choice" || carrier === "prefix" ? '<mc:AlternateContent><mc:Choice Requires="f">'+other+'</mc:Choice><mc:Choice Requires="'+(carrier === "prefix" ? "Coast" : "p")+'">'+active+'</mc:Choice><mc:Fallback>'+other+'</mc:Fallback></mc:AlternateContent>' : carrier === "fallback" ? '<mc:AlternateContent><mc:Choice Requires="f">'+other+'</mc:Choice><mc:Fallback>'+active+'</mc:Fallback></mc:AlternateContent>' : carrier === "process" ? '<f:bridge>'+active+'</f:bridge>' : carrier === "ignored" ? '<f:opaque>'+active+'</f:opaque>'+other : carrier === "nested" ? property('<mc:AlternateContent><mc:Choice Requires="p">'+value+'</mc:Choice><mc:Fallback>Other</mc:Fallback></mc:AlternateContent>') : active;
  const ns = office + (strict ? group + "Properties" : group + "-properties");
  const xml = `<p:Properties xmlns:p="${ns}" xmlns:Coast="${ns}" xmlns:v="${office}docPropsVTypes" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:bridge"${carrier === "unknown-attribute" ? ' f:dependency="Coast"' : ''}>${body}<!--metadata--></p:Properties>`;
  const main = '<w:p><w:bookmarkStart w:id="1" w:name="Coast"/><w:r><w:t>Coast body</w:t></w:r><w:bookmarkEnd w:id="1"/><w:hyperlink w:anchor="Coast"><w:r><w:t>Jump</w:t></w:r></w:hyperlink></w:p>';
  const parts = readPackage(await chartFixture({strict, definitions: [], body: main, resources: [{name: "metadata/props.xml", type: native ? `application/vnd.openxmlformats-officedocument.${group}-properties+xml;audit=coast` : "application/xml", bytes: xml}], relationships: native ? [{owner: "/", id: "properties", type: r + "/" + group + "-properties", target: "metadata/props.xml"}] : []}));
  parts.set("[Content_Types].xml", enc(dec(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = !native || carrier === "unknown-attribute" || carrier === "opaque-host";
  if (route === "sdk") {const pending = editDocumentBookmarks(input, {operation: "bookmarks.set", options: {bookmark: 1, name: "Bay", references: "update", output: "-"}}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: sink}); if (rejected) await expect(pending).rejects.toMatchObject({code: "unsupported-edit"}); else await pending;}
  else {const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const result = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})})).exec("docx bookmarks set /input --bookmark 1 --name Bay --references update --output - > /output"); expect(result.exitCode, result.stderr).toBe(rejected ? 1 : 0); if (rejected) expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);}
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer); if (rejected) expect(output.length).toBe(0); else {const saved = readPackage(output); for (const [name, bytes] of parts) expect(saved.get(name), name).toEqual(name === "word/document.xml" ? enc(dec(bytes).replace('w:name="Coast"', 'w:name="Bay"').replace('w:anchor="Coast"', 'w:anchor="Bay"')) : bytes);}
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
 });
}
