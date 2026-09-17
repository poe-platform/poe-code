import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, Inches, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentComments, editDocumentLists, editDocumentNotes, editDocumentLinks, editDocumentSections, editDocumentStories, inspectDocument, inspectDocumentComments, inspectDocumentNotes, inspectDocumentSections, insertDocumentImage, openDocumentLocations, writeArchive } from "./index.js";
import { replacementPng } from "../tests/fixtures/image-replacement.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
type Node = ReturnType<typeof xmlStructure>;
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
const key = (name: string) => decodeURI(name).toLowerCase();
const sidecar = (name: string) => name.slice(0, name.lastIndexOf("/") + 1) + "_rels/" + name.slice(name.lastIndexOf("/") + 1) + ".rels";
async function fixture(strict: boolean, kind: "docx" | "dotx", encoded: boolean, spelling: "coherent" | "basename" | "directory" | "ascii-case") {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const dir = encoded ? "r%C3%A9cords" : "récords", main = dir + "/" + (encoded ? "c%C3%B4te.xml" : "côte.xml"), header = dir + "/" + (encoded ? "t%C3%AAte.xml" : "tête.xml");
  const relationName = (owner: string) => {
    const name = sidecar(owner), slash = name.lastIndexOf("/");
    if (spelling === "basename") return name.slice(0, slash + 1) + (encoded ? decodeURI(name.slice(slash + 1)) : encodeURI(name.slice(slash + 1)));
    if (spelling === "directory") return (encoded ? "récords" : "r%C3%A9cords") + name.slice(dir.length);
    if (spelling === "ascii-case") return [...name].map(char => char >= "a" && char <= "z" ? char.toUpperCase() : char).join("");
    return name;
  };
  const mainRels = relationName(main), headerRels = relationName(header);
  const namespaces = 'xmlns:w="' + w + '" xmlns:r="' + r + '" xmlns:f="urn:original:relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"';
  const opaque = '<f:record f:value="retained"><!--opaque--></f:record>';
  const rels = (body: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!--retained edges-->' + body + "</Relationships>";
  const edge = (id: string, type: string, target: string, external = false) => '<Relationship Id="' + id + '" Type="' + type + '" Target="' + target + '"' + (external ? ' TargetMode="External"' : "") + "/>";
  const parts = new Map(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/' + main + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + (kind === "docx" ? "document" : "template") + '.main+xml"/><Override PartName="/' + header + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
    "_rels/.rels": rels(edge("main", r + "/officeDocument", main)),
    [main]: "<w:document " + namespaces + "><w:body>" + opaque + '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:pPr><w:r><w:t>Original body</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    [header]: "<w:hdr " + namespaces + '><w:p><w:hyperlink r:id="link"><w:r><w:t>Original header</w:t></w:r></w:hyperlink></w:p>' + opaque + "</w:hdr>",
    [mainRels]: rels(edge("header", r + "/header", header.slice(dir.length + 1)) + edge("audit", "urn:original:audit", "../audit/exact.xml")),
    [headerRels]: rels(edge("link", r + "/hyperlink", "https://example.invalid/original", true) + edge("audit", "urn:original:audit", "../audit/exact.xml")),
    "audit/exact.xml": "<audit>Exact retained bytes</audit>"
  }).map(([name, text]) => [name, encode(text)]));
  const memory = Volume.fromJSON({ "/zip": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/zip", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/zip") as Buffer), parts, main, header, mainRels, headerRels, w, r, opaque };
}
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const spelling of ["coherent", "basename", "directory", "ascii-case"] as const) for (const operation of ["relationship", "image", "settings", "copy", "link"] as const) for (const route of (operation === "copy" || operation === "link" ? ["sdk", "shell"] as const : ["model", "sdk", "shell"] as const)) it(`${route} ${operation} retains independently spelled ${spelling} relationships; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input, parts, main, header, mainRels, headerRels, w, r, opaque } = await fixture(strict, kind, encoded, spelling);
  const memory = Volume.fromJSON({ "/output": "", "/input": Buffer.from(input) }), png = replacementPng(89);
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.part.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "part" },
    { operation: "model.opc.part.Part.rels.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "rels" },
    { operation: "model.opc.rel.Relationships.get_or_add_ext_rel.call", receiver: { resultHandle: "rels" }, arguments: { reltype: "urn:original:added", targetRef: "https://example.invalid/added" } }
  ] };
  const assertInspection = (inspection: Awaited<ReturnType<typeof inspectDocument>>) => {
    expect(inspection.kind).toBe(kind); expect(inspection.dialect).toBe(strict ? "strict" : "transitional");
    expect(inspection.parts.map(part => part.name)).toEqual([...parts.keys()].map(name => "/" + decodeURI(name)).sort());
    expect(inspection.counts).toMatchObject({ paragraphs: 3, sections: 2 });
    expect(inspection.relationships).toHaveLength(5);
    expect(inspection.relationships).toEqual(expect.arrayContaining([
      { owner: "/", id: "main", type: r + "/officeDocument", target: main, external: false },
      { owner: "/" + decodeURI(main), id: "header", type: r + "/header", target: header.slice(header.lastIndexOf("/") + 1), external: false },
      { owner: "/" + decodeURI(main), id: "audit", type: "urn:original:audit", target: "../audit/exact.xml", external: false },
      { owner: "/" + decodeURI(header), id: "link", type: r + "/hyperlink", target: "https://example.invalid/original", external: true },
      { owner: "/" + decodeURI(header), id: "audit", type: "urn:original:audit", target: "../audit/exact.xml", external: false }
    ]));
  };
  if (route === "model") {
    const document = await Document(input, textContext);
    expect(document.part.rels.at("header").target_part.partname.toString()).toBe("/récords/tête.xml");
    expect(document.part.rels.xml).toBe(new TextDecoder().decode(parts.get(mainRels)));
    expect(document.part.rels.at("header").target_part.rels.xml).toBe(new TextDecoder().decode(parts.get(headerRels)));
    if (operation === "relationship") expect(document.part.rels.get_or_add_ext_rel("urn:original:added", "https://example.invalid/added")).toBe("rId1");
    else if (operation === "image") await document.add_picture(png, Inches(1), Inches(0.5));
    else document.settings.odd_and_even_pages_header_footer = true;
    await document.save(sink);
  } else if (route === "sdk") {
    const inspection = await inspectDocument(input, textContext); assertInspection(inspection);
    if (operation === "relationship") { const result = await applyStyleModelBatch(input, batch, textContext); await result.save(sink); }
    else if (operation === "image") await insertDocumentImage(input, { operation: "images.add", options: { paragraph: 1, file: { kind: "bytes", base64: btoa(String.fromCharCode(...png)) }, width: { value: 1, unit: "in" }, height: { value: 0.5, unit: "in" }, output: "-" } }, context);
    else if (operation === "settings") await editDocumentSections(input, { operation: "sections.set", options: { all: true, evenAndOddHeaders: true, output: "-" } }, context);
    else if (operation === "copy") await editDocumentStories(input, { operation: "headers.set", options: { section: 2, linkToPrevious: false, output: "-" } }, context);
    else await editDocumentLinks(input, { operation: "links.add", options: { paragraph: 1, target: "https://example.invalid/added", text: "Added link", output: "-" } }, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/image.png", png); await fs.writeFile("/ops.json", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const inspection = await shell.exec("docx inspect /input --json"); expect(inspection.exitCode, inspection.stderr).toBe(0); assertInspection(JSON.parse(inspection.stdout).data);
    const command = operation === "relationship" ? "batch --ops-file /ops.json" : operation === "image" ? "images add --paragraph 1 --file /image.png --width 1in --height 0.5in" : operation === "settings" ? "sections set --all --even-and-odd-headers true" : operation === "copy" ? "headers set --section 2 --link-to-previous false" : "links add --paragraph 1 --target https://example.invalid/added --text 'Added link'";
    const result = await shell.exec("docx " + command + " /input --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(new Set([...saved.keys()].map(key)).size).toBe(saved.size);
  expect([...saved.keys()].filter(name => parts.has(name))).toEqual([...parts.keys()]);
  const dirty = new Set([mainRels, ...(operation === "relationship" || operation === "settings" ? [] : [main]), ...(operation === "image" || operation === "settings" || operation === "copy" ? ["[Content_Types].xml"] : [])]);
  for (const [name, bytes] of parts) if (!dirty.has(name)) expect(saved.get(name), name).toEqual(bytes);
  const edges = nodes(xmlStructure(saved.get(mainRels)!)).filter(node => node.name.endsWith("}Relationship")), oldEdges = nodes(xmlStructure(parts.get(mainRels)!)).filter(node => node.name.endsWith("}Relationship"));
  for (const edge of oldEdges) expect(edges).toContainEqual(edge);
  expect(edges).toHaveLength(oldEdges.length + 1);
  expect(new TextDecoder().decode(saved.get(main))).toContain(opaque);
  const document = await Document(output, textContext); expect(String(document.part.partname)).toBe("/récords/côte.xml");
  const added = edges.find(edge => !oldEdges.some(old => old.attributes["{}Id"] === edge.attributes["{}Id"]))!;
  if (operation === "relationship" || operation === "link") {
    expect(added.attributes["{}Target"]).toBe("https://example.invalid/added"); expect(added.attributes["{}TargetMode"]).toBe("External");
    if (operation === "link") expect(document.paragraphs[0]!.text).toContain("Added link");
  } else if (operation === "image") {
    expect(document.inline_shapes).toHaveLength(1); expect(document.inline_shapes[0]!.width.emu).toBe(914400); expect(document.inline_shapes[0]!.height.emu).toBe(457200);
    const target = key(new URL(added.attributes["{}Target"]!, "https://package.invalid/" + main).pathname.slice(1)); expect([...saved].find(([name]) => key(name) === target)![1]).toEqual(png);
  } else if (operation === "settings") {
    expect(document.settings.odd_and_even_pages_header_footer).toBe(true); expect(added.attributes["{}Type"]).toBe(r + "/settings");
  } else {
    const local = (await inspectDocumentSections(output, {}, textContext)).items[1]!.headers.default.part!;
    expect(local).not.toBe("/" + decodeURI(header));
    const copy = [...saved].find(([name]) => key("/" + name) === key(local))!;
    expect(copy[1]).toEqual(parts.get(header)); expect([...saved].find(([name]) => key(name) === key(sidecar(copy[0])))![1]).toEqual(parts.get(headerRels));
    expect(nodes(xmlStructure(copy[1])).filter(node => node.name === "{" + w + "}hyperlink")).toHaveLength(1);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const spelling of ["coherent", "basename", "directory", "ascii-case"] as const) for (const operation of ["styles", "fresh-header", "comment", "footnote", "endnote", "numbering"] as const) for (const route of (operation === "footnote" || operation === "endnote" || operation === "numbering" ? ["sdk", "shell"] as const : ["model", "sdk", "shell"] as const)) it(`${route} creates ${operation} retaining independently spelled ${spelling} relationships; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input, parts, main, header, mainRels, headerRels, w, r, opaque } = await fixture(strict, kind, encoded, spelling);
  const memory = Volume.fromJSON({ "/output": "", "/input": Buffer.from(input) });
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } }, context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink };
  const inspection = await inspectDocument(input, textContext); expect(inspection.kind).toBe(kind); expect(inspection.dialect).toBe(strict ? "strict" : "transitional"); expect(inspection.relationships).toHaveLength(5);
  const locations = await openDocumentLocations(input, textContext), select = locations.range(locations.at("paragraph", 1).token, 0, "Original body".length).token;
  const batch = { version: 1, operations: operation === "styles" ? [
    { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {} }
  ] : [
    { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
    { operation: "model.section.Section.header.get", receiver: { resultHandle: "sections", index: 1 }, arguments: {}, resultHandle: "header" },
    { operation: "model.section._Header.is_linked_to_previous.set", receiver: { resultHandle: "header" }, arguments: { value: false } }
  ] };
  if (route === "model") {
    const document = await Document(input, { ...textContext, timestamp: new Date("2026-01-02T03:04:05Z") });
    expect(document.part.rels.xml).toBe(new TextDecoder().decode(parts.get(mainRels)));
    expect(document.part.rels.at("header").target_part.rels.xml).toBe(new TextDecoder().decode(parts.get(headerRels)));
    if (operation === "styles") expect(document.styles.length).toBeGreaterThan(0);
    else if (operation === "fresh-header") document.sections[1]!.header.is_linked_to_previous = false;
    else document.add_comment(document.paragraphs[0]!.runs[0]!, "Created comment", "Original", "O");
    await document.save(sink);
  } else if (route === "sdk") {
    if (operation === "styles" || operation === "fresh-header") { const document = await applyStyleModelBatch(input, batch, textContext); await document.save(sink); }
    else if (operation === "comment") await editDocumentComments(input, { operation: "comments.add", options: { select, author: "Original", timestamp: "2026-01-02T03:04:05Z", text: "Created comment", output: "-" } }, context);
    else if (operation === "numbering") await editDocumentLists(input, { operation: "lists.add", options: { paragraph: 2, kind: "decimal", text: "Created list", output: "-" } }, context);
    else await editDocumentNotes(input, { operation: "notes.add", options: { paragraph: 2, kind: operation, text: "Created note", output: "-" } }, context);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify(batch)));
    const shell = new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    const before = await shell.exec("docx inspect /input --json"); expect(before.exitCode, before.stderr).toBe(0); expect(JSON.parse(before.stdout).data.relationships).toEqual(inspection.relationships);
    const command = operation === "styles" || operation === "fresh-header" ? "batch --ops-file /ops.json" : operation === "comment" ? "comments add --select '" + select + "' --author Original --timestamp 2026-01-02T03:04:05Z --text 'Created comment'" : operation === "numbering" ? "lists add --paragraph 2 --kind decimal --text 'Created list'" : "notes add --paragraph 2 --kind " + operation + " --text 'Created note'";
    const result = await shell.exec("docx " + command + " /input --output - > /output"); expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  expect(new Set([...saved.keys()].map(key)).size).toBe(saved.size); expect([...saved.keys()].filter(name => parts.has(name))).toEqual([...parts.keys()]);
  const dirty = new Set([mainRels, "[Content_Types].xml", ...(operation === "styles" ? [] : [main])]);
  for (const [name, bytes] of parts) if (!dirty.has(name)) expect(saved.get(name), name).toEqual(bytes);
  expect(new TextDecoder().decode(saved.get(main))).toContain(opaque);
  const edges = nodes(xmlStructure(saved.get(mainRels)!)).filter(node => node.name.endsWith("}Relationship")), oldEdges = nodes(xmlStructure(parts.get(mainRels)!)).filter(node => node.name.endsWith("}Relationship"));
  for (const edge of oldEdges) expect(edges).toContainEqual(edge);
  expect(edges).toHaveLength(oldEdges.length + (operation === "comment" && route === "model" ? 2 : 1));
  expect(new Set(edges.map(edge => edge.attributes["{}Id"])).size).toBe(edges.length);
  const expectedType = operation === "fresh-header" ? "header" : operation === "comment" ? "comments" : operation === "footnote" || operation === "endnote" ? operation + "s" : operation;
  const added = edges.find(edge => edge.attributes["{}Type"] === r + "/" + expectedType && !oldEdges.some(old => old.attributes["{}Id"] === edge.attributes["{}Id"]))!; expect(added).toBeDefined();
  const target = key(new URL(added.attributes["{}Target"]!, "https://package.invalid/" + main).pathname.slice(1)), newPart = [...saved].find(([name]) => key(name) === target)!;
  expect(newPart).toBeDefined(); expect(nodes(xmlStructure(newPart[1]))[1]!.name).toBe("{" + w + "}" + (operation === "fresh-header" ? "hdr" : expectedType));
  const document = await Document(output, textContext); expect(String(document.part.partname)).toBe("/récords/côte.xml");
  if (operation === "styles") expect(document.styles.length).toBeGreaterThan(0);
  else if (operation === "fresh-header") {
    expect(document.sections[1]!.header.is_linked_to_previous).toBe(false); expect(document.sections[1]!.header.paragraphs.map(p => p.text)).toEqual([""]);
    expect(document.sections[0]!.header.paragraphs[0]!.text).toBe("Original header"); expect(newPart[0]).not.toBe(header);
  } else if (operation === "comment") {
    const comments = await inspectDocumentComments(output, { operation: "comments.list", options: {} }, textContext);
    expect(comments.issues).toEqual([]); expect(comments.items).toHaveLength(1); expect(comments.items[0]).toMatchObject({ author: "Original", text: "Created comment", timestamp: route === "model" ? "2026-01-02T03:04:05.000Z" : "2026-01-02T03:04:05Z", issues: [] }); expect(comments.items[0]!.range).not.toBeNull();
  } else if (operation === "numbering") {
    expect(document.paragraphs.map(p => p.text)).toEqual(["Original body", "Second", "Created list"]);
    const definitions = nodes(xmlStructure(newPart[1])); expect(definitions.some(n => n.name === "{" + w + "}numFmt" && n.attributes["{" + w + "}val"] === "decimal")).toBe(true);
    expect(nodes(xmlStructure(saved.get(main)!)).some(n => n.name === "{" + w + "}numId")).toBe(true);
  } else {
    const notes = await inspectDocumentNotes(output, { operation: "notes.list", options: { kind: operation } }, textContext);
    expect(notes.items).toHaveLength(1); expect(notes.items[0]).toMatchObject({ kind: operation, text: "Created note", type: "normal" }); expect(notes.items[0]!.references).toHaveLength(1);
  }
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
