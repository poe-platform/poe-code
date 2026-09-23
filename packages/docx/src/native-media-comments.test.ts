import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine, editDocumentComments, inspectDocumentComments, writeArchive } from "./index.js";
import { chartFixture, chartContext } from "../tests/fixtures/charts.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const role of ["comments", "thread", "ids", "extra", "people", "unrelated"] as const)
for (const parameter of ["", ";audit=people", '; audit="commentsExtended; people"'] as const)
for (const action of ["set", "remove"] as const) for (const route of ["sdk", "shell"] as const)
it(`${route} ${action} preserves native comment roles with ${role} MIME ${JSON.stringify(parameter)}; ${kind} strict=${strict}`, async () => {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships", w14 = "http://schemas.microsoft.com/office/word/2010/wordml", w15 = "http://schemas.microsoft.com/office/word/2012/wordml", cid = "http://schemas.microsoft.com/office/word/2016/wordml/cid", cex = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
  const encode = (text: string) => new TextEncoder().encode(text), decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  const comment = (id: number, pid: string, text: string) => `<w:comment w:id="${id}" w:author="Mira"><w:p x:paraId="${pid}"><w:r><w:t>${text}</w:t></w:r></w:p></w:comment>`;
  const entries = [
    {name: "comments", suffix: "comments", namespace: w, relation: r + "/comments", bytes: `<w:comments xmlns:w="${w}" xmlns:x="${w14}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x">${comment(4,"000000A1","Earlier")}${comment(9,"000000B2","Current")}</w:comments>`},
    {name: "thread", suffix: "commentsExtended", namespace: w15, relation: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended", bytes: `<m:commentsEx xmlns:m="${w15}"><m:commentEx m:paraId="000000A1" m:done="1"/><m:commentEx m:paraId="000000B2" m:paraIdParent="000000A1" m:done="0"/></m:commentsEx>`},
    {name: "ids", suffix: "commentsIds", namespace: cid, relation: "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds", bytes: `<m:commentsIds xmlns:m="${cid}"><m:commentId m:paraId="000000A1" m:durableId="00000011"/><m:commentId m:paraId="000000B2" m:durableId="00000022"/></m:commentsIds>`},
    {name: "extra", suffix: "commentsExtensible", namespace: cex, relation: "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible", bytes: `<m:commentsExtensible xmlns:m="${cex}"><m:commentExtensible m:durableId="00000011"/><m:commentExtensible m:durableId="00000022"/></m:commentsExtensible>`},
    {name: "people", suffix: "people", namespace: w15, relation: "http://schemas.microsoft.com/office/2011/relationships/people", bytes: `<m:people xmlns:m="${w15}"><m:person m:author="Mira"><m:presenceInfo m:providerId="None" m:userId="Mira"/></m:person></m:people>`}
  ];
  const parts = readPackage(await chartFixture({strict, definitions: [], body: '<w:p><w:r><w:t>Retained body</w:t></w:r></w:p>', resources: [...entries.map(e => ({name: `audit/${e.name}.xml`, type: `application/vnd.openxmlformats-officedocument.wordprocessingml.${e.suffix}+xml` + (role === e.name ? parameter : ""), bytes: e.bytes})), {name: "audit/unrelated.xml", type: "application/xml" + (role === "unrelated" ? parameter : ""), bytes: '<record xmlns="urn:original:retained">Metadata</record>'}], relationships: entries.map(e => ({owner: "/word/document.xml", id: e.name, type: e.relation, target: `../audit/${e.name}.xml`}))}));
  parts.set("[Content_Types].xml", encode(decode(parts.get("[Content_Types].xml")!).replace("wordprocessingml.document.main+xml", `wordprocessingml.${kind === "dotx" ? "template" : "document"}.main+xml`)));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}); await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, chartContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer);
  if (route === "sdk") {
    const read = await inspectDocumentComments(input, {operation: "comments.list", options: {}}, chartContext); expect(read.extensions.map(e => e.part).sort()).toEqual(["/audit/extra.xml", "/audit/ids.xml", "/audit/people.xml", "/audit/thread.xml"]);
    await editDocumentComments(input, action === "set" ? {operation: "comments.set", options: {comment: 2, text: "Updated", output: "-"}} : {operation: "comments.remove", options: {comment: 2, output: "-"}}, {...chartContext, encoding: {order: "input", compression: "store"}, stdout: {async write(bytes) {memory.appendFileSync("/output", bytes);}}});
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: chartContext.limits})}));
    const read = await shell.exec("docx comments list /input --json"); expect(read.exitCode, read.stderr).toBe(0); expect(JSON.parse(read.stdout).data).toEqual(await inspectDocumentComments(input, {operation: "comments.list", options: {}}, chartContext, "resource"));
    expect((await inspectDocumentComments(input, {operation: "comments.list", options: {}}, chartContext)).extensions.map(e => e.part).sort()).toEqual(["/audit/extra.xml", "/audit/ids.xml", "/audit/people.xml", "/audit/thread.xml"]);
    const result = await shell.exec(`docx comments ${action} /input --comment 2 ${action === "set" ? "--text Updated " : ""}--output - > /output`); expect(result.exitCode, result.stderr).toBe(0); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const [name, bytes] of parts) {
    if (name === "audit/comments.xml") {expect(decode(saved.get(name)!)).toContain(comment(4,"000000A1","Earlier")); if (action === "remove") expect(saved.get(name)).toEqual(encode(decode(bytes).replace(comment(9,"000000B2","Current"), "")));}
    else if (action === "remove" && ["audit/thread.xml", "audit/ids.xml", "audit/extra.xml"].includes(name)) {
      const removed = name === "audit/thread.xml" ? '<m:commentEx m:paraId="000000B2" m:paraIdParent="000000A1" m:done="0"/>' : name === "audit/ids.xml" ? '<m:commentId m:paraId="000000B2" m:durableId="00000022"/>' : '<m:commentExtensible m:durableId="00000022"/>';
      expect(saved.get(name), name).toEqual(encode(decode(bytes).replace(removed, "")));
    }
    else expect(saved.get(name), name).toEqual(bytes);
  }
  const after = await inspectDocumentComments(new Uint8Array(memory.readFileSync("/output") as Buffer), {operation: "comments.list", options: {}}, chartContext); expect(after.items.map(c => c.text)).toEqual(action === "set" ? ["Earlier", "Updated"] : ["Earlier"]);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
