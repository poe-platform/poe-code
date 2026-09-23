import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, editDocumentLinks, inspectDocumentLinks, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const pr = "http://schemas.openxmlformats.org/package/2006/relationships", mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process", "nested"] as const)
for (const padded of [false, true]) for (const action of ["reuse", "same", "retarget", "remove"] as const)
for (const route of ["sdk", "shell"] as const)
it(`${route} ${action} native hyperlink relationship in ${carrier}; ${kind} strict=${strict} padded=${padded}`, async () => {
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const scalar = (value: string) => padded ? ` &#x9;${value}&#xA; ` : value;
  const row = `<pr:Relationship Id="${scalar("shared")}" Type="${scalar(r + "/hyperlink")}" Target="${scalar("https://coast.invalid/first")}" TargetMode="External">original <!--row--> 海<?row keep?></pr:Relationship>`;
  const inactive = '<pr:Relationship Id="rId1" Type="urn:original:inert" Target="/absent.xml"/>';
  const choice = (body: string) => `<mc:AlternateContent><mc:Choice Requires="pr">${body}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>`;
  const content = carrier === "direct" ? row : carrier === "choice" ? choice(row) : carrier === "fallback" ? `<mc:AlternateContent><mc:Choice Requires="f">${inactive}</mc:Choice><mc:Fallback>${row}</mc:Fallback></mc:AlternateContent>` : carrier === "process" ? `<f:carrier>${row}</f:carrier>` : choice(`<f:carrier>${choice(row)}</f:carrier>`);
  const retained = `<f:opaque>${inactive}<f:Relationship Id="rId2"/></f:opaque>`;
  const xml = `<pr:Relationships xmlns:pr="${pr}" xmlns:mc="${mc}" xmlns:f="urn:original:future" mc:Ignorable="f" mc:ProcessContent="f:carrier">\n${content}\n${retained}<?root keep?></pr:Relationships>`;
  const parts = readPackage(await textFixture('<w:p><w:hyperlink r:id="shared"><w:r><w:rPr><w:b/></w:rPr><w:t>Original coast</w:t></w:r></w:hyperlink></w:p>', {}, strict));
  const relName = "word/_rels/document.xml.rels";
  parts.set(relName, encode(xml));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  expect((await Document(input, textContext)).paragraphs[0]!.hyperlinks[0]!.address).toBe("https://coast.invalid/first");
  const operation = action === "reuse" ? "links.add" : action === "remove" ? "links.remove" : "links.set";
  const target = action === "retarget" ? "https://coast.invalid/next" : "https://coast.invalid/first";
  if (route === "sdk") {
    const result = await editDocumentLinks(input, action === "reuse"
      ? {operation: "links.add", options: {output: "-", paragraph: 1, text: "Other", target}}
      : action === "remove" ? {operation: "links.remove", options: {output: "-", link: 1}}
      : {operation: "links.set", options: {output: "-", link: 1, target}}, {...textContext, encoding: {order: "input", compression: "store"}, stdout: sink});
    expect(result.changed).toBe(action !== "same");
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
    const result = await shell.exec(`docx ${operation.replace(".", " ")} /input ${action === "reuse" ? "--paragraph 1 --text Other" : "--link 1"} ${action === "remove" ? "" : "--target " + target} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), rels = (await Document(output, textContext)).part.rels;
  expect(rels.has("shared")).toBe(action === "same" || action === "reuse");
  expect([...rels.keys()]).toEqual(action === "remove" ? [] : [action === "retarget" ? "rId2" : "shared"]);
  const resultXml = decode(saved.get(relName)!);
  expect(resultXml).toContain(retained); expect(resultXml).toContain("<?root keep?>");
  if (action === "same" || action === "reuse") expect(saved.get(relName)).toEqual(parts.get(relName));
  else expect(resultXml).toContain(content.replace(row, ""));
  const links = (await inspectDocumentLinks(output, {}, textContext)).items;
  expect(links.map(item => item.address)).toEqual(action === "remove" ? [] : action === "reuse" ? [target, target] : [target]);
  expect(decode(saved.get("word/document.xml")!)).toContain("<w:rPr><w:b/></w:rPr><w:t>Original coast</w:t>");
  for (const [name, bytes] of parts) if (name !== relName && name !== "word/document.xml") expect(saved.get(name), name).toEqual(bytes);
  if (action === "same") expect(saved.get("word/document.xml")).toEqual(parts.get("word/document.xml"));
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
