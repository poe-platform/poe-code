import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, XmlPartView, applyStyleModelBatch, createDocxInspectionCommandEngine, getDocumentXml, inspectDocument, replaceDocumentXmlPart, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const canonical = "/reports/café.xml";
async function fixture(strict: boolean, encoded: boolean, main: boolean) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const name = encoded ? "reports/caf%C3%A9.xml" : "reports/café.xml";
  const mainName = main ? name : "reports/document.xml";
  const document = (text: string) => `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const original = main ? document("Original") : '<records><value>Original</value></records>';
  const replacement = main ? document("Revised") : '<records><value>Revised</value></records>';
  const rels = (inner: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
  const members = new Map<string, Uint8Array>([
    ["[Content_Types].xml", encode(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${mainName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)],
    ["_rels/.rels", encode(rels(`<Relationship Id="main" Type="${r}/officeDocument" Target="${mainName}"/>${main ? "" : `<Relationship Id="record" Type="urn:original:record" Target="${name}"/>`}`))],
    [mainName, encode(document("Original"))],
    [name, encode(original)],
    ["audit/keep.xml", encode('<x:record xmlns:x="urn:original:audit"><!--keep--><?audit keep?> untouched </x:record>')]
  ]);
  const volume = Volume.fromJSON({ "/zip": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(volume.readFileSync("/zip") as Buffer), name, original: encode(original), replacement: encode(replacement), members };
}

for (const strict of [false, true]) for (const encoded of [false, true]) for (const main of [false, true]) for (const route of ["model", "sdk", "cli"] as const) it(`uses inspected canonical names through ${route}: strict=${strict} encoded=${encoded} main=${main}`, async () => {
  const { input, name, original, replacement, members } = await fixture(strict, encoded, main);
  const inventory = await inspectDocument(input, textContext);
  expect(inventory.parts.find(part => part.name === canonical)?.bytes).toBe(original.length);
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/replacement": Buffer.from(replacement), "/out": "", "/err": "" });
  if (route === "model") {
    const model = await Document(input, textContext);
    const part = model.part.package.parts.find(part => String(part.partname) === canonical)!;
    expect(part.blob).toEqual(original);
    if (main) model.paragraphs[0]!.runs[0]!.text = "Revised";
    else { expect(part).toBeInstanceOf(XmlPartView); (part as XmlPartView).element.children[0]!.text = "Revised"; }
    await model.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  } else if (route === "sdk") {
    expect(await getDocumentXml(input, textContext, { part: canonical, raw: true })).toEqual(original);
    const data = await getDocumentXml(input, textContext, { part: canonical });
    expect(data).toMatchObject({ part: canonical, encoding: "base64", content: Buffer.from(original).toString("base64") });
    const result = await replaceDocumentXmlPart(input, replacement, { part: canonical, output: "-" }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
    expect(result.changed).toBe(true);
    expect(result.changes[0]!.after.value.part).toBe(canonical);
  } else {
    const command = createDocxInspectionCommandEngine({ limits: textContext.limits });
    const run = (args: string[]) => command.execute({ args: args.map(encode), cwd: "/", signal: textContext.signal,
      filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
      stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
    expect((await run(["xml", "get", "/input", "--part", canonical, "--raw"])).exitCode, String(volume.readFileSync("/err"))).toBe(0);
    expect(volume.readFileSync("/out")).toEqual(Buffer.from(original));
    volume.writeFileSync("/out", "");
    expect((await run(["xml", "set", "/input", "--part", canonical, "--file", "/replacement", "--output", "-"])).exitCode, String(volume.readFileSync("/err"))).toBe(0);
  }
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), saved = readPackage(output);
  expect([...saved.keys()]).toEqual([...members.keys()]);
  for (const [key, bytes] of members) if (key !== name) expect(saved.get(key)).toEqual(bytes);
  if (route !== "model" || !main) expect(saved.get(name)).toEqual(replacement);
  const reopened = await Document(output, textContext);
  expect(reopened.paragraphs[0]!.text).toBe(main ? "Revised" : "Original");
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const encoded of [false, true]) for (const route of ["model", "sdk", "cli", "shell"] as const) for (const operation of ["read-relationships", "add-relationship", "rename-part", "read-style", "edit-style"] as const) it(`retains canonical dependent owners through ${route}: ${operation} strict=${strict} encoded=${encoded}`, async () => {
  const { members, name } = await fixture(strict, encoded, true);
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const styleName = encoded ? "reports/styl%C3%A9.xml" : "reports/stylé.xml";
  const relationshipName = "reports/_rels/" + name.slice("reports/".length) + ".rels";
  const styleRelationships = "reports/_rels/" + styleName.slice("reports/".length) + ".rels";
  const style = `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style></w:styles>`;
  members.set(styleName, encode(style));
  members.set(relationshipName, encode(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--retain--><Relationship Id="style" Type="${r}/styles" Target="${styleName.slice("reports/".length)}"/><Relationship Id="inert" Type="urn:original:inert" Target="https://invalid.example/never-fetch" TargetMode="External"/></Relationships>`));
  members.set(styleRelationships, encode('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--owned relation--><Relationship Id="audit" Type="urn:original:audit" Target="../audit/keep.xml"/></Relationships>'));
  const types = new TextDecoder().decode(members.get("[Content_Types].xml"));
  members.set("[Content_Types].xml", encode(types.slice(0, -"</Types>".length) + `<Override PartName="/${styleName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/${styleRelationships}" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`));
  const volume = Volume.fromJSON({ "/input": "", "/out": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...members].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext);
  const input = new Uint8Array(volume.readFileSync("/input") as Buffer);
  if (route === "model") {
    const document = await Document(input, textContext);
    if (operation === "read-relationships") expect(document.part.rels.xml).toContain('Id="inert"');
    if (operation === "add-relationship") expect(document.part.rels.get_or_add_ext_rel("urn:original:added", "https://invalid.example/also-inert")).toBe("rId1");
    if (operation === "rename-part") document.styles.part.partname = "/records/revised.xml";
    if (operation === "read-style") expect(document.styles.at("Normal").name).toBe("Normal");
    if (operation === "edit-style") document.styles.at("Normal").name = "Revised";
    await document.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  } else {
    const ref = (resultHandle: string) => ({ resultHandle });
    const batch = { version: 1, operations: [
      { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
      { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
      { operation: "model.styles.styles.Styles.part.get", receiver: ref("styles"), arguments: {}, resultHandle: "stylePart" },
      { operation: "model.opc.part.Part.rels.get", receiver: ref("main"), arguments: {}, resultHandle: "relationships" },
      { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Normal" }, resultHandle: "style" },
      operation === "read-relationships" ? { operation: "model.opc.rel.Relationships.xml.get", receiver: ref("relationships"), arguments: {} }
        : operation === "add-relationship" ? { operation: "model.opc.rel.Relationships.get_or_add_ext_rel.call", receiver: ref("relationships"), arguments: { reltype: "urn:original:added", targetRef: "https://invalid.example/also-inert" } }
        : operation === "rename-part" ? { operation: "model.opc.part.Part.partname.set", receiver: ref("stylePart"), arguments: { value: "/records/revised.xml" } }
        : { operation: `model.styles.style.BaseStyle.name.${operation === "read-style" ? "get" : "set"}`, receiver: ref("style"), arguments: operation === "read-style" ? {} : { value: "Revised" } }
    ] };
    if (route === "sdk") {
      const result = await applyStyleModelBatch(input, batch, textContext);
      if (operation === "read-relationships") expect(result.results.at(-1)!.value).toContain('Id="inert"');
      if (operation === "read-style") expect(result.results.at(-1)!.value).toBe("Normal");
      expect(result.affected).toBe(operation.startsWith("read-") ? 0 : 1);
      await result.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
    } else {
      const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
      if (route === "cli") {
        volume.writeFileSync("/err", "");
        const result = await engine.execute({ args: ["batch", "/input", "--ops-json", JSON.stringify(batch), "--output", "-"].map(encode), cwd: "/", signal: textContext.signal,
          filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
          stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { volume.appendFileSync("/err", bytes); } } });
        expect(result.exitCode, String(volume.readFileSync("/err"))).toBe(0);
      } else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify(batch)));
        const shell = new Shell({ fs }).use(docxCommands({ engine }));
        const result = await shell.exec("docx batch /input --ops-file /ops.json --output - > /saved");
        expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
        volume.writeFileSync("/out", await fs.readFile("/saved"));
        expect(await fs.readFile("/input")).toEqual(input);
      }
    }
  }
  const saved = new Uint8Array(volume.readFileSync("/out") as Buffer), parts = readPackage(saved), reopened = await Document(saved, textContext);
  expect(parts.get("audit/keep.xml")).toEqual(members.get("audit/keep.xml"));
  expect(reopened.part.rels.at("inert").target_ref).toBe("https://invalid.example/never-fetch");
  expect(reopened.styles.at(operation === "edit-style" ? "Revised" : "Normal").name).toBe(operation === "edit-style" ? "Revised" : "Normal");
  if (operation === "rename-part") {
    expect(parts.has(styleName)).toBe(false); expect(parts.get("records/revised.xml")).toEqual(encode(style));
    expect(parts.has(styleRelationships)).toBe(false); expect(parts.has("records/_rels/revised.xml.rels")).toBe(true);
    expect(reopened.styles.part.rels.at("audit").target_part.partname.toString()).toBe("/audit/keep.xml");
  }
  if (operation === "add-relationship") expect(reopened.part.rels.at("rId1").target_ref).toBe("https://invalid.example/also-inert");
  if (operation.startsWith("read-")) expect(parts).toEqual(members);
});
