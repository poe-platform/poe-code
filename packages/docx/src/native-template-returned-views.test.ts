import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (value: string) => new TextEncoder().encode(value);
const ref = (resultHandle: string) => ({ resultHandle });
const properties = ["document", "styles", "settings", "comments", "inline_shapes", "core_properties"] as const;
const context = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z"), author: "Estuary reviewer" };

async function templateFixture(strict: boolean, body: string): Promise<Uint8Array> {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, "dotx", body), parts = readPackage(input);
  parts.set("[Content_Types].xml", encode(new TextDecoder().decode(parts.get("[Content_Types].xml")!).replace("</Types>", '<Default Extension="bin" ContentType="application/octet-stream"/></Types>')));
  parts.set("word/_rels/document.xml.rels", encode(new TextDecoder().decode(parts.get("word/_rels/document.xml.rels")!).replace("</Relationships>", '<!--Inert edge--><Relationship Id="estuary" Type="urn:estuary:payload" Target="../archive/payload.bin"/></Relationships>')));
  parts.set("archive/payload.bin", Uint8Array.of(0, 17, 234, 128, 255));
  const memory = Volume.fromJSON({ "/input": "" });
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, context);
  return new Uint8Array(memory.readFileSync("/input") as Buffer);
}

for (const strict of [false, true]) for (const property of properties)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} consumes native template DocumentPart.${property} and retains its kind; strict=${strict}`, async () => {
  const input = await templateFixture(strict, "<w:p><w:r><w:t>Estuary template</w:t></w:r></w:p>");
  const before = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const expected = property === "styles" ? 3 : property === "settings" ? false : property === "core_properties" ? "Document" : 0;
  const reader = property === "document" ? "model.document.Document.paragraphs.get"
    : property === "styles" ? "model.styles.styles.Styles.__len__.get"
      : property === "settings" ? "model.settings.Settings.odd_and_even_pages_header_footer.get"
        : property === "comments" ? "model.comments.Comments.__len__.get"
          : property === "inline_shapes" ? "model.shape.InlineShapes.__len__.get"
            : "model.opc.coreprops.CoreProperties.title.get";
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: `model.parts.document.DocumentPart.${property}.get`, receiver: ref("main"), arguments: {}, resultHandle: "returned" },
    { operation: reader, receiver: ref("returned"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context), main = doc.part;
    if (property === "document") { expect(main.document.part).toBe(main); expect(main.document.paragraphs[0]!.text).toBe("Estuary template"); }
    if (property === "styles") { expect(main.styles.part.package).toBe(main.package); expect(main.styles.length).toBe(expected); }
    if (property === "settings") { expect(main.settings.part.package).toBe(main.package); expect(main.settings.odd_and_even_pages_header_footer).toBe(expected); }
    if (property === "comments") { expect(main.comments.length).toBe(expected); expect(main.comments.get(0)).toBeNull(); }
    if (property === "inline_shapes") expect(main.inline_shapes.length).toBe(expected);
    if (property === "core_properties") { expect(main.core_properties.part.package).toBe(main.package); expect(main.core_properties.title).toBe(expected); }
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context);
    expect(result.results).toHaveLength(3);
    if (property === "document") expect(result.results[2]!.value).toHaveLength(1);
    else expect(result.results[2]!.value).toBe(expected);
    await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const creating = !["document", "inline_shapes"].includes(property);
      const result = await shell.exec("docx batch /input --ops-file /ops --json --timestamp 2026-01-02T03:04:06Z --author 'Estuary reviewer'" + (creating ? " --output /output" : ""));
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      const envelope = JSON.parse(result.stdout); expect(envelope.ok).toBe(true); expect(envelope.errors).toEqual([]); expect(envelope.data.results).toHaveLength(3);
      if (property === "document") expect(envelope.data.results[2].data).toHaveLength(1);
      else expect(envelope.data.results[2].data).toBe(expected);
      memory.writeFileSync("/output", creating ? await fs.readFile("/output") : input);
      expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of before) if (!["[Content_Types].xml", "word/_rels/document.xml.rels", "_rels/.rels"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const reopened = await api.Document(output, context);
  expect(reopened.part.content_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml");
  expect(reopened.part.element.namespace).toBe(strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main");
  expect(reopened.paragraphs[0]!.text).toBe("Estuary template");
  expect(reopened.part.rels.at("estuary").target_ref).toBe("../archive/payload.bin");
  expect(new TextDecoder().decode(saved.get("word/_rels/document.xml.rels")!)).toContain('<!--Inert edge--><Relationship Id="estuary" Type="urn:estuary:payload" Target="../archive/payload.bin"/>');
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const role of ["styles", "settings", "comments"] as const)
for (const route of ["model", "sdk", "shell"] as const)
it(`${route} edits separately loaded ${role} returned views in a template owner; strict=${strict}`, async () => {
  const input = await templateFixture(strict, "<w:p><w:r><w:t>Retained estuary</w:t></w:r></w:p>");
  const before = readPackage(input), memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const name = "/separate/owner.xml", contentType = `application/vnd.openxmlformats-officedocument.wordprocessingml.${role}+xml;source=estuary`;
  const blob = encode(`<?xml version="1.0"?><!--Retained prolog--><n:${role} xmlns:n="${word}"><!--Owner marker--></n:${role}><?audit keep?>`);
  const prefix = `model.parts.${role}.${role[0]!.toUpperCase()}${role.slice(1)}Part`;
  const mutation = role === "styles" ? { operation: "model.styles.styles.Styles.add_style.call", arguments: { name: "Estuary", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } } }
    : role === "settings" ? { operation: "model.settings.Settings.odd_and_even_pages_header_footer.set", arguments: { value: true } }
      : { operation: "model.comments.Comments.add_comment.call", arguments: { text: "Owner note", author: "Estuary reviewer", initials: "ER" } };
  const operations = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: `${prefix}.load.call`, arguments: { partname: name, contentType, blob: { kind: "bytes", base64: Buffer.from(blob).toString("base64") }, ownerPackage: ref("package") }, resultHandle: "part" },
    { operation: `${prefix}.${role}.get`, receiver: ref("part"), arguments: {}, resultHandle: "returned" },
    { ...mutation, receiver: ref("returned") },
    { operation: `${prefix}.blob.get`, receiver: ref("part"), arguments: {} }
  ];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  if (route === "model") {
    const doc = await api.Document(input, context);
    if (role === "styles") { const part = await api.StylesPart.load(name, contentType, blob, doc.part.package); const style = part.styles.add_style("Estuary", api.WD_STYLE_TYPE.PARAGRAPH); expect(style.part).toBe(part); }
    if (role === "settings") { const part = await api.SettingsPart.load(name, contentType, blob, doc.part.package); part.settings.odd_and_even_pages_header_footer = true; expect(part.settings.part).toBe(part); }
    if (role === "comments") { const part = await api.CommentsPart.load(name, contentType, blob, doc.part.package); expect(part.comments.add_comment("Owner note", "Estuary reviewer", "ER").part).toBe(part); }
    await doc.save(sink);
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, context); expect(result.results).toHaveLength(6);
    expect(result.results[5]!.value).toMatchObject({ kind: "bytes" }); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", encode(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: context.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --timestamp 2026-01-02T03:04:06Z --output /output --json");
      expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const envelope = JSON.parse(response.stdout); expect(envelope.data.results).toHaveLength(6); expect(envelope.data.results[5].data).toMatchObject({ kind: "bytes" });
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [part, bytes] of before) if (part !== "[Content_Types].xml" && !(role === "comments" && part === "word/_rels/document.xml.rels")) expect(saved.get(part), part).toEqual(bytes);
  const relTree = xmlStructure(saved.get("word/_rels/document.xml.rels")!);
  const edgeNodes = (node: typeof relTree): (typeof relTree)[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : edgeNodes(child))];
  const edges = edgeNodes(relTree).filter(node => node.name === "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship");
  expect(edges.map(edge => edge.attributes)).toEqual(role === "comments" ? [
    { "{}Id": "estuary", "{}Type": "urn:estuary:payload", "{}Target": "../archive/payload.bin" },
    { "{}Id": "rId1", "{}Type": `${strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}/styles`, "{}Target": "styles1.xml" }
  ] : [{ "{}Id": "estuary", "{}Type": "urn:estuary:payload", "{}Target": "../archive/payload.bin" }]);
  expect(new TextDecoder().decode(saved.get("word/_rels/document.xml.rels")!)).toContain('<!--Inert edge--><Relationship Id="estuary" Type="urn:estuary:payload" Target="../archive/payload.bin"/>');
  const xml = new TextDecoder().decode(saved.get(name.slice(1))!); expect(xml).toContain("<!--Owner marker-->"); expect(xml).toContain("<!--Retained prolog-->"); expect(xml).toContain("<?audit keep?>");
  const tree = xmlStructure(saved.get(name.slice(1))!), nodes = (node: typeof tree): (typeof tree)[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
  const all = nodes(tree);
  if (role === "styles") expect(all.filter(node => node.name === `{${word}}name`).map(node => node.attributes[`{${word}}val`])).toEqual(["Estuary"]);
  if (role === "settings") expect(all.filter(node => node.name === `{${word}}evenAndOddHeaders`)).toHaveLength(1);
  if (role === "comments") { expect(all.find(node => node.name === `{${word}}t`)!.children).toEqual(["Owner note"]); expect(all.find(node => node.name === `{${word}}comment`)!.attributes).toMatchObject({ [`{${word}}author`]: "Estuary reviewer", [`{${word}}date`]: "2026-01-02T03:04:06.000Z" }); }
  const reopened = await api.Document(output, context); expect(reopened.part.content_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml"); expect(reopened.paragraphs[0]!.text).toBe("Retained estuary");
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
