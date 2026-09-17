import { Volume } from "memfs";
import { beforeAll, expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, replaceDocumentImage, writeArchive } from "./index.js";
import { replacementFixture, replacementPng, replacementBinary, replacementContext } from "../tests/fixtures/image-replacement.js";
import { readPackage } from "../tests/assertions.js";
const pr = "http://schemas.openxmlformats.org/package/2006/relationships", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
let original: Uint8Array;
beforeAll(async () => { original = await replacementFixture(1); });
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "process"] as const)
for (const retainedBy of ["none", "active", "inactive"] as const)
for (const shared of [false, true]) for (const route of ["sdk", "shell"] as const)
it(`${route} replaces image in ${carrier} relationships with ${retainedBy} resource owner; ${kind} strict=${strict} shared=${shared}`, async () => {
  const parts = readPackage(original), before = await Document(original, replacementContext);
  const edge = [...before.part.rels.values()].find(row => row.reltype.endsWith("/image"))!;
  const targetName = edge.target_part.partname.toString().slice(1), name = "word/_rels/document.xml.rels";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const row = `<pr:Relationship Id=" &#x9;${edge.rId} " Type=" ${r}/image " Target=" ${edge.target_ref} " TargetMode="Internal">海<!--row--><?keep row?></pr:Relationship>`;
  const content = carrier === "direct" ? row : carrier === "choice" ? `<mc:AlternateContent><mc:Choice Requires="pr">${row}</mc:Choice><mc:Fallback/></mc:AlternateContent>` : `<f:carrier>${row}</f:carrier>`;
  const retainedRow = `<pr:Relationship Id="stored" Type="urn:original:stored" Target="${edge.target_ref}#fragment"/>`;
  const retained = retainedBy === "none" ? "" : retainedBy === "active" ? retainedRow : `<mc:AlternateContent><mc:Choice Requires="pr"/><mc:Fallback>${retainedRow}</mc:Fallback></mc:AlternateContent>`;
  const xml = `<pr:Relationships xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">${content}<!--between-->${retained}<?retain xml?></pr:Relationships>`;
  parts.set(name, encode(xml));
  for (const [part, bytes] of parts) if (part.endsWith(".xml") || part.endsWith(".rels")) parts.set(part, encode(decode(bytes).replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main").replaceAll("http://schemas.openxmlformats.org/officeDocument/2006/relationships", r).replaceAll("http://schemas.openxmlformats.org/drawingml/2006/", strict ? "http://purl.oclc.org/ooxml/drawingml/" : "http://schemas.openxmlformats.org/drawingml/2006/").replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, replacementContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") await replaceDocumentImage(input, {operation: "images.replace", options: {image: 1, shared, file: replacementBinary(), output: "-"}}, {...replacementContext, stdout: sink});
  else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/replacement.png", replacementPng(89));
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: replacementContext.limits})}));
    const result = await shell.exec(`docx images replace /input --image 1 ${shared ? "--shared" : ""} --file /replacement.png --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), doc = await Document(output, replacementContext);
  const changed = [...doc.part.rels.values()].find(row => row.reltype === r + "/image")!;
  expect(changed.target_part.blob).toEqual(replacementPng(89)); expect(doc.part.rels.has(edge.rId)).toBe(shared);
  const oldRetained = retainedBy === "inactive" || retainedBy === "active" && !shared;
  expect(saved.has(targetName)).toBe(oldRetained); if (oldRetained) expect(saved.get(targetName)).toEqual(parts.get(targetName));
  const resultXml = decode(saved.get(name)!);
  if (retainedBy === "inactive" || retainedBy === "active" && !shared) expect(resultXml).toContain(retained);
  if (retainedBy === "active") {expect(doc.part.rels.at("stored").target_part.blob).toEqual(shared ? replacementPng(89) : replacementPng()); expect(doc.part.rels.at("stored").target_ref.endsWith("#fragment")).toBe(true);}
  expect(resultXml).toContain("<!--between-->"); expect(resultXml).toContain("<?retain xml?>");
  if (!shared) expect(resultXml).toContain(content.replace(row, ""));
  else expect(resultXml).toContain(row.replace(`Target=" ${edge.target_ref} "`, `Target="${changed.target_ref}"`));
  for (const [part, bytes] of parts) if (![name, "word/document.xml", "[Content_Types].xml", targetName].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
