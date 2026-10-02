import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { Document, createDocxInspectionCommandEngine, inspectDocument, writeArchive } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const owner of ["root", "document"] as const) for (const route of ["model", "sdk", "shell"] as const)
for (const [label, attributes, text, expected] of [
  ["collapsed ID", 'Id=" &#x9;audit&#xA; " Type="urn:original:audit" Target="/data.xml"', "", {id: "audit", type: "urn:original:audit", target: "/data.xml", external: false}],
  ["collapsed type", 'Id="audit" Type=" &#x9;urn:original:audit&#xA; " Target="/data.xml"', "", {id: "audit", type: "urn:original:audit", target: "/data.xml", external: false}],
  ["collapsed target", 'Id="audit" Type="urn:original:audit" Target=" &#x9;/data.xml&#xA; "', "", {id: "audit", type: "urn:original:audit", target: "/data.xml", external: false}],
  ["empty URI type", 'Id="audit" Type="" Target="/data.xml"', "", {id: "audit", type: "", target: "/data.xml", external: false}],
  ["empty external target", 'Id="audit" Type="urn:original:audit" Target="" TargetMode="External"', "", {id: "audit", type: "urn:original:audit", target: "", external: true}],
  ["relationship simple text", 'Id="audit" Type="urn:original:audit" Target="/data.xml"', 'Retained 海 &amp; dunes<!--annotation--><?keep text?>', {id: "audit", type: "urn:original:audit", target: "/data.xml", external: false}]
] as const)
it(`${route} validates and retains native ${label} in ${owner}; ${kind} strict=${strict}`, async () => {
  const encode = (text: string) => new TextEncoder().encode(text), parts = readPackage(await textFixture('<w:p><w:r><w:t>Original coast</w:t></w:r></w:p>', {}, strict));
  const name = owner === "root" ? "_rels/.rels" : "word/_rels/document.xml.rels";
  parts.set(name, encode(new TextDecoder().decode(parts.get(name)).replace("</Relationships>", `<Relationship ${attributes}>${text}</Relationship></Relationships>`)));
  parts.set("data.xml", encode("<audit>Original data</audit>"));
  parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("</Types>", '<Override PartName="/data.xml" ContentType="application/xml"/></Types>')));
  if (kind === "dotx") parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("wordprocessingml.document.main+xml", "wordprocessingml.template.main+xml")));
  const memory = Volume.fromJSON({"/input": "", "/output": ""}), sink = {async write(bytes: Uint8Array) {memory.appendFileSync("/output", bytes);}};
  await writeArchive({comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z")}))}, {async write(bytes) {memory.appendFileSync("/input", bytes);}}, {order: "input", compression: "store"}, textContext);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
  const shell = new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})}));
  if (label === "empty URI type") {
    if (route === "model") await expect(Document(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    else if (route === "sdk") await expect(inspectDocument(input, textContext)).rejects.toMatchObject({ code: "invalid-package" });
    else {
      const result = await shell.exec("docx inspect /input --json"); expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: null, affected: 0, errors: [{ code: "invalid-package" }] });
    }
    expect(await fs.readFile("/input")).toEqual(input); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
    return;
  }
  if (route === "model") {const model = await Document(input, textContext), rels = owner === "root" ? model.part.package.rels : model.part.rels; const edge = rels.at("audit"); expect({id: edge.rId, type: edge.reltype, target: edge.target_ref, external: edge.is_external}).toEqual(expected); await model.save(sink); for (const [name, bytes] of parts) expect(readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer)).get(name), name).toEqual(bytes);}
  else {const data = route === "sdk" ? await inspectDocument(input, textContext) : await (async () => {const result = await shell.exec("docx inspect /input --json"); expect(result.exitCode, result.stderr).toBe(0); return JSON.parse(result.stdout).data as Awaited<ReturnType<typeof inspectDocument>>;})(); expect(data.relationships.find(row => row.owner === (owner === "root" ? "/" : "/word/document.xml") && row.id === "audit")).toEqual({owner: owner === "root" ? "/" : "/word/document.xml", ...expected});}
  expect(await fs.readFile("/input")).toEqual(input); expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
