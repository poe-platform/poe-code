import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine, editDocumentControlRepeats, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const modern = [
  {name: "commentsExtended", root: "commentsEx", namespace: "http://schemas.microsoft.com/office/word/2012/wordml"},
  {name: "commentsIds", root: "commentsIds", namespace: "http://schemas.microsoft.com/office/word/2016/wordml/cid"},
  {name: "commentsExtensible", root: "commentsExtensible", namespace: "http://schemas.microsoft.com/office/word/2018/wordml/cex"},
  {name: "people", root: "people", namespace: "http://schemas.microsoft.com/office/word/2012/wordml"}
];
function nodes(node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] {
  return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["main", "header", "comments", "unrelated", ...modern.map(m => m.name)])
for (const parameter of ["", ";audit=commentsExtended", '; audit="people; coast"'] as const)
for (const carrier of ["native", "inactive"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} clones with ${role} MIME ${JSON.stringify(parameter)} and ${carrier} header identities; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", encode = (s: string) => new TextEncoder().encode(s), decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const repeated = '<w:sdt xmlns:v="http://schemas.microsoft.com/office/word/2012/wordml"><w:sdtPr><w:id w:val="1"/><v:repeatingSection/></w:sdtPr><w:sdtContent><w:sdt><w:sdtPr><w:id w:val="7"/><v:repeatingSectionItem/></w:sdtPr><w:sdtContent><w:p><w:bookmarkStart w:id="5" w:name="Harbor"/><w:commentRangeStart w:id="3"/><w:r><w:t>Retained range</w:t></w:r><w:commentRangeEnd w:id="3"/><w:r><w:commentReference w:id="3"/></w:r><w:bookmarkEnd w:id="5"/></w:p></w:sdtContent></w:sdt></w:sdtContent></w:sdt>';
  const retained = '<w:sdt><w:sdtPr><w:id w:val="2"/><w:text/></w:sdtPr><w:sdtContent><w:p><w:bookmarkStart w:id="1" w:name="Harbor_1"/><w:r><w:t>Retained header</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:sdtContent></w:sdt>';
  const header = `<w:hdr xmlns:w="${w}">${carrier === "native" ? retained : `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x="urn:original:unavailable"><mc:Choice Requires="x">${retained}</mc:Choice><mc:Fallback><w:p/></mc:Fallback></mc:AlternateContent>`}<!--retained--></w:hdr>`;
  const comment = '<w:comment w:id="3" w:author="Reviewer"><w:p><w:r><w:t>Review note</w:t></w:r></w:p></w:comment>', descriptor = modern.find(m => m.name === role);
  const resources = [
    {name: "audit/header.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml" + (role === "header" ? parameter : ""), bytes: header},
    {name: "audit/comments.xml", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml" + (role === "comments" ? parameter : ""), bytes: `<w:comments xmlns:w="${w}">${comment}</w:comments>`},
    {name: "audit/metadata.xml", type: descriptor ? `application/vnd.openxmlformats-officedocument.wordprocessingml.${descriptor.name}+xml` + parameter : "application/xml" + (role === "unrelated" ? parameter : ""), bytes: descriptor ? `<m:${descriptor.root} xmlns:m="${descriptor.namespace}"/>` : '<record xmlns="urn:original:audit">Retained</record>'}
  ];
  const parts = readPackage(await chartFixture({strict, definitions: [], body: repeated + '<w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr>', resources, relationships: [{owner: "/word/document.xml", id: "header", type: r + "/header", target: "../audit/header.xml"}, {owner: "/word/document.xml", id: "comments", type: r + "/comments", target: "../audit/comments.xml"}]}));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml", (`application/vnd.openxmlformats-officedocument.wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml` + (role === "main" ? parameter : "")).replaceAll('"', '&quot;'))));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), rejected = descriptor !== undefined;
  if (route === "sdk") {
    const pending = editDocumentControlRepeats(input, {control: 1, data: [{values: []}, {values: []}], output: "-"}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
    if (rejected) await expect(pending).rejects.toMatchObject({code: "unsupported-edit", message: "Modern comments cannot be cloned."}); else expect((await pending).changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const result = await shell.exec('docx controls repeat /input --control 1 --data-json \'[{"values":[]},{"values":[]}]\' --output - > /output'); expect(result.exitCode, result.stderr).toBe(rejected ? 1 : 0); if (rejected) expect(result.stderr).toContain("unsupported-edit"); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
  if (rejected) expect(output.length).toBe(0);
  else {
    const saved = readPackage(output), main = nodes(xmlStructure(saved.get("word/document.xml")!)), comments = nodes(xmlStructure(saved.get("audit/comments.xml")!)), name = (local: string) => `{${w}}${local}`;
    const bookmarks = main.filter(n => n.name === name("bookmarkStart")); expect(bookmarks.map(n => n.attributes[name("id")])).toEqual(["2", "3"]); expect(bookmarks.map(n => n.attributes[name("name")])).toEqual(["Harbor_2", "Harbor_3"]);
    const controls = main.filter(n => n.name === name("id")).map(n => n.attributes[name("val")]); expect(controls).toEqual(["1", "3", "4"]);
    const refs = main.filter(n => n.name === name("commentReference")).map(n => n.attributes[name("id")]); expect(refs).toEqual(["1", "2"]);
    for (const id of refs) {const owned = comments.filter(n => n.name === name("comment") && n.attributes[name("id")] === id); expect(owned).toHaveLength(1); expect(nodes(owned[0]!).filter(n => n.name === name("t")).flatMap(n => n.children)).toEqual(["Review note"]);}
    expect(decode(saved.get("audit/comments.xml")!)).toContain(comment);
    for (const [part, bytes] of parts) if (!["word/document.xml", "audit/comments.xml"].includes(part)) expect(saved.get(part), part).toEqual(bytes);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
