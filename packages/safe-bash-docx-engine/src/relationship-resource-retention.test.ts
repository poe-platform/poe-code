import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentStories, sanitizeDocument, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (resultHandle: string) => ({resultHandle}), quote = (text: string) => "'" + text.split("'").join("'\\''") + "'";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const resource of ["header", "footer", "object", "native-object"] as const)
for (const carrier of ["direct", "choice", "process"] as const)
for (const retainedBy of ["none", "active", "inactive"] as const)
for (const route of resource.endsWith("object") ? ["sdk", "shell"] as const : ["model", "batch", "sdk", "shell", "model-shell"] as const)
it(`${route} removes ${resource} in ${carrier} relationships with ${retainedBy} resource owner; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const body = resource.endsWith("object") ? `<w:p><w:r><w:object xmlns:o="urn:schemas-microsoft-com:office:office">${resource === "native-object" ? '<w:objectEmbed r:id="bound"/>' : '<o:OLEObject r:id="bound"/>'}</w:object></w:r></w:p>` : `<w:p/><w:sectPr><w:${resource}Reference w:type="default" r:id="bound"/></w:sectPr>`;
  const parts = readPackage(await textFixture(body, {}, strict)), name = "word/_rels/document.xml.rels", target = resource.endsWith("object") ? "payload.bin" : resource + ".xml", targetName = "word/" + target;
  parts.set(targetName, resource.endsWith("object") ? new Uint8Array([8, 3, 5]) : encode(`<w:${resource === "header" ? "hdr" : "ftr"} xmlns:w="${w}"><w:p><w:r><w:t>Retained 海</w:t></w:r></w:p></w:${resource === "header" ? "hdr" : "ftr"}>`));
  const row = `<pr:Relationship Id=" &#x9;bound " Type=" ${r}/${resource.endsWith("object") ? "oleObject" : resource} " Target=" ${target} " TargetMode="Internal"/>`;
  const content = carrier === "direct" ? row : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="pr">${row}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : `<f:carrier>${row}</f:carrier>`;
  const retainedRow = `<pr:Relationship Id="stored" Type="urn:original:stored" Target="${target}"/>`;
  const retained = retainedBy === "none" ? "" : retainedBy === "active" ? retainedRow : `<mc:AlternateContent><mc:Choice Requires="pr"/><mc:Fallback>${retainedRow}</mc:Fallback></mc:AlternateContent>`;
  const xml = `<pr:Relationships xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">${content}<!--between-->${retained}<?retain xml?></pr:Relationships>`;
  parts.set(name, encode(xml));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("</Types>", `<Override PartName="/${targetName}" ContentType="${resource.endsWith("object") ? "application/vnd.openxmlformats-officedocument.oleObject" : `application/vnd.openxmlformats-officedocument.wordprocessingml.${resource}+xml`}"/></Types>`).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), context = {...textContext, encoding: {order: "input" as const, compression: "store" as const}, stdout: sink};
  if (resource === "object" && strict) {
    if (route === "sdk") await expect(sanitizeDocument(input, {remove: ["objects"], output: "-"}, context)).rejects.toMatchObject({code: "invalid-package"});
    else {
      const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
      const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
      const result = await shell.exec("docx sanitize /input --remove objects --output - > /output");
      expect(result.exitCode).toBe(1); expect(result.stderr).toContain("invalid-package"); expect(await fs.readFile("/input")).toEqual(input); expect((await fs.readFile("/output")).length).toBe(0);
    }
    expect(memory.readFileSync("/output").length).toBe(0); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input)); return;
  }
  const batch = {version: 1 as const, operations: [
    {operation: "model.document.Document.sections.get", receiver: ref("document"), arguments: {}, resultHandle: "sections"},
    {operation: "model.section.Sections.__getitem__.get", receiver: ref("sections"), arguments: {index: 0}, resultHandle: "section"},
    {operation: `model.section.Section.${resource}.get`, receiver: ref("section"), arguments: {}, resultHandle: "story"},
    {operation: `model.section._${resource === "header" ? "Header" : "Footer"}.is_linked_to_previous.set`, receiver: ref("story"), arguments: {value: true}}
  ]};
  if (route === "model") {const doc = await Document(input, textContext); doc.sections.at(0)[resource as "header" | "footer"].is_linked_to_previous = true; await doc.save(sink);}
  else if (route === "batch") await (await applyStyleModelBatch(input, batch, textContext)).save(sink);
  else if (route === "sdk") {
    if (resource.endsWith("object")) await sanitizeDocument(input, {remove: ["objects"], output: "-"}, context);
    else await editDocumentStories(input, {operation: resource === "header" ? "headers.remove" : "footers.remove", options: {section: 1, output: "-"}}, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const command = route === "model-shell" ? "batch /input --ops-json " + quote(JSON.stringify(batch)) : resource.endsWith("object") ? "sanitize /input --remove objects" : resource + "s remove /input --section 1";
    const result = await shell.exec("docx " + command + " --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, textContext);
  expect(doc.part.rels.has("bound")).toBe(false); expect(doc.part.rels.has("stored")).toBe(retainedBy === "active");
  expect(saved.has(targetName)).toBe(retainedBy !== "none");
  if (retainedBy !== "none") expect(saved.get(targetName)).toEqual(parts.get(targetName));
  expect(decode(saved.get(name)!)).toBe(xml.replace(row, ""));
  expect(decode(saved.get("word/document.xml")!)).not.toContain(resource.endsWith("object") ? resource === "native-object" ? "objectEmbed" : "OLEObject" : resource + "Reference");
  for (const [part, bytes] of parts) if (![name, "word/document.xml", "[Content_Types].xml", targetName].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  if (retainedBy !== "none") expect(saved.get("[Content_Types].xml")).toEqual(parts.get("[Content_Types].xml"));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
