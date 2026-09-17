import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Shell, MemoryFileSystem } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { Document, applyStyleModelBatch, createDocxInspectionCommandEngine, editDocumentSections, editDocumentStories, inspectDocumentSections, inspectDocumentStories, writeArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const encode = (text: string) => new TextEncoder().encode(text);
type Node = ReturnType<typeof xmlStructure>;
const nodes = (node: Node): Node[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
const relationshipName = (name: string) => name.slice(0, name.lastIndexOf("/") + 1) + "_rels/" + name.slice(name.lastIndexOf("/") + 1) + ".rels";
async function fixture(strict: boolean, kind: "docx" | "dotx", encoded: boolean, storyKind: "headers" | "footers", variant: "default" | "first" | "even", rich = false, local = false, settings = false) {
  const w = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main", r = strict ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const dir = encoded ? "r%C3%A9cords" : "récords", main = dir + "/" + (encoded ? "c%C3%B4te.xml" : "côte.xml"), story = dir + "/" + (encoded ? "t%C3%AAte.xml" : "tête.xml"), second = dir + "/" + (encoded ? "apr%C3%A8s.xml" : "après.xml"), setting = dir + "/" + (encoded ? "r%C3%A8gles.xml" : "règles.xml");
  const name = storyKind === "headers" ? "header" : "footer", root = name === "header" ? "hdr" : "ftr";
  const namespace = 'xmlns:w="' + w + '" xmlns:r="' + r + '" xmlns:f="urn:original:story" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f"';
  const p = (text: string) => "<w:p><w:r><w:t>" + text + "</w:t></w:r></w:p>";
  const ref = (id: string) => "<w:" + name + 'Reference w:type="' + variant + '" r:id="' + id + '"/>';
  const opaque = '<f:record f:owner="stored"><!--preserve opaque--></f:record>';
  const body = p("First") + "<w:p><w:pPr><w:sectPr>" + ref("original") + "</w:sectPr></w:pPr></w:p>" + p("Second") + "<w:p><w:pPr><w:sectPr>" + (local ? ref("local") : "") + "</w:sectPr></w:pPr></w:p>" + p("Third") + "<w:sectPr/>";
  const content = rich ? '<w:p><w:hyperlink r:id="link"><w:r><w:t>Original link</w:t></w:r></w:hyperlink></w:p>' + opaque : p("Original story");
  const storyXml = '<w:' + root + " " + namespace + '><!--story marker--><?retained original?>' + content + "</w:" + root + ">";
  const rels = (content: string) => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + content + "</Relationships>";
  const edge = (id: string, type: string, target: string, external = false) => '<Relationship Id="' + id + '" Type="' + type + '" Target="' + target + '"' + (external ? ' TargetMode="External"' : "") + "/>";
  const override = (part: string, type: string) => '<Override PartName="/' + part + '" ContentType="' + type + '"/>';
  const parts = new Map(Object.entries({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + override(main, "application/vnd.openxmlformats-officedocument.wordprocessingml." + (kind === "docx" ? "document" : "template") + ".main+xml") + override(story, "application/vnd.openxmlformats-officedocument.wordprocessingml." + name + "+xml") + (local ? override(second, "application/vnd.openxmlformats-officedocument.wordprocessingml." + name + "+xml") : "") + (settings ? override(setting, "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml") : "") + "</Types>",
    "_rels/.rels": rels(edge("main", r + "/officeDocument", main)),
    [main]: "<w:document " + namespace + "><w:body>" + opaque + body + "</w:body></w:document>",
    [story]: storyXml,
    [relationshipName(main)]: rels(edge("original", r + "/" + name, story.slice(dir.length + 1)) + (local ? edge("local", r + "/" + name, second.slice(dir.length + 1)) : "") + (settings ? edge("settings", r + "/settings", setting.slice(dir.length + 1)) : "") + edge("audit", "urn:original:audit", "../audit/exact.xml")),
    [relationshipName(story)]: rels(edge("link", r + "/hyperlink", "https://example.invalid/original", true) + edge("retained", "urn:original:resource", "../audit/exact.xml")),
    "audit/exact.xml": "<audit>Original exact bytes</audit>"
  }).map(([key, value]) => [key, encode(value)]));
  if (local) { parts.set(second, encode(storyXml.replace("Original link", "Local link"))); parts.set(relationshipName(second), parts.get(relationshipName(story))!); }
  if (settings) parts.set(setting, encode('<w:settings ' + namespace + '><w:evenAndOddHeaders w:val="0"/>' + opaque + "</w:settings>"));
  const memory = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, { async write(bytes) { memory.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  return { input: new Uint8Array(memory.readFileSync("/archive") as Buffer), parts, main, story, second, setting, w, r, opaque };
}
const keys = { headers: { default: "header", first: "first_page_header", even: "even_page_header" }, footers: { default: "footer", first: "first_page_footer", even: "even_page_footer" } } as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const storyKind of ["headers", "footers"] as const) for (const variant of ["default", "first", "even"] as const) for (const mode of ["shared", "clone", "clone-text", "remove", "relink"] as const) for (const route of (mode === "shared" ? ["model", "sdk", "shell"] as const : ["sdk", "shell"] as const)) it(`${route} ${mode} canonical ${storyKind}/${variant}; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const rich = mode === "clone" || mode === "remove" || mode === "relink";
  const { input, parts, main, story, second, w, r, opaque } = await fixture(strict, kind, encoded, storyKind, variant, rich, mode === "relink");
  const memory = Volume.fromJSON({ "/output": "", "/input": Buffer.from(input) });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  const section = mode === "remove" ? 1 : 2, operation = mode === "remove" ? `${storyKind}.remove` as const : `${storyKind}.set` as const;
  const options = { section, variant, output: "-", ...(mode === "shared" ? { shared: true, text: "Updated story" } : mode === "clone" || mode === "clone-text" ? { linkToPrevious: false, ...(mode === "clone-text" ? { text: "Updated story" } : {}) } : mode === "relink" ? { linkToPrevious: true } : {}) };
  if (route === "model") {
    const document = await Document(input, textContext);
    document.sections[1]![keys[storyKind][variant]].paragraphs[0]!.text = "Updated story";
    await document.save(context.stdout);
  } else if (route === "sdk") {
    const data = await editDocumentStories(input, { operation, options }, context);
    expect(data.changed).toBe(true); expect(data.affectedSections).toEqual(mode === "shared" ? [1, 2, 3] : [section]);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const effect = mode === "shared" ? '--shared --text "Updated story"' : mode === "clone" ? "--link-to-previous false" : mode === "clone-text" ? '--link-to-previous false --text "Updated story"' : mode === "relink" ? "--link-to-previous true" : "";
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec(`docx ${storyKind} ${mode === "remove" ? "remove" : "set"} /input --section ${section} --variant ${variant} ${effect} --output - > /output`);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe("");
    memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  const sections = (await inspectDocumentSections(output, {}, textContext)).items, bindings = sections.map(item => item[storyKind][variant]);
  const canonical = "/" + decodeURI(story), after = bindings[1]!.part;
  if (mode === "shared") {
    expect(bindings.map(item => item.part)).toEqual([canonical, canonical, canonical]);
    expect(new TextDecoder().decode(saved.get(story))).toContain("Updated story");
  } else if (mode === "clone" || mode === "clone-text") {
    expect(bindings[0]!.part).toBe(canonical); expect(bindings[2]!.part).toBe(canonical); expect(bindings[2]!.linkedToPrevious).toBe(false); expect(after).not.toBe(canonical);
    const copied = [...saved].find(([name]) => "/" + decodeURI(name) === after)!;
    if (mode === "clone") {
      expect(copied[1]).toEqual(parts.get(story));
      expect(saved.get(relationshipName(copied[0]))).toEqual(parts.get(relationshipName(story)));
    } else expect(new TextDecoder().decode(copied[1])).toContain("Updated story");
  } else if (mode === "remove") {
    expect(bindings[0]!.part).toBeNull(); expect(bindings[1]!.part).toBe(canonical); expect(bindings[2]!.part).toBe(canonical); expect(bindings[1]!.linkedToPrevious).toBe(false);
  } else {
    expect(bindings.map(item => item.part)).toEqual([canonical, canonical, "/" + decodeURI(second)]);
    expect(bindings[1]!.linkedToPrevious).toBe(true); expect(bindings[2]!.linkedToPrevious).toBe(false);
  }
  const changed = new Set([main, relationshipName(main), "[Content_Types].xml", ...(mode === "shared" ? [story] : [])]);
  for (const [name, bytes] of parts) if (!changed.has(name)) expect(saved.get(name), name).toEqual(bytes);
  expect([...saved.keys()].filter(name => parts.has(name))).toEqual([...parts.keys()]);
  const mainXml = new TextDecoder().decode(saved.get(main)); expect(mainXml).toContain(opaque);
  expect(nodes(xmlStructure(saved.get(main)!)).filter(n => n.name === "{" + w + "}sectPr")).toHaveLength(3);
  const edges = nodes(xmlStructure(saved.get(relationshipName(main))!)).filter(n => n.name.endsWith("}Relationship"));
  expect(edges.find(edge => edge.attributes["{}Id"] === "audit")).toEqual(nodes(xmlStructure(parts.get(relationshipName(main))!)).find(n => n.attributes["{}Id"] === "audit"));
  for (const node of nodes(xmlStructure(saved.get(main)!)).filter(n => n.name === "{" + w + "}" + (storyKind === "headers" ? "headerReference" : "footerReference"))) {
    const edge = edges.find(e => e.attributes["{}Id"] === node.attributes["{" + r + "}id"])!;
    const target = decodeURI(new URL(edge.attributes["{}Target"]!, "https://package.invalid/" + main).pathname.slice(1));
    expect([...saved.keys()].map(decodeURI)).toContain(target);
  }
  const info = await inspectDocumentStories(output, { operation: `${storyKind}.get`, options: { section: 2, variant } }, textContext);
  expect(info.items[0]!.text).toBe(mode === "shared" || mode === "clone-text" ? "Updated story" : "Original link");
  const reopened = await Document(output, textContext); expect(String(reopened.part.partname)).toBe("/récords/côte.xml"); expect(reopened.sections).toHaveLength(3);
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const existing of [false, true]) for (const route of ["model", "sdk", "shell"] as const) it(`${route} canonical global settings existing=${existing}; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input, parts, main, setting, w, r, opaque } = await fixture(strict, kind, encoded, "headers", "default", false, false, existing);
  const memory = Volume.fromJSON({ "/output": "" });
  const context = { ...textContext, encoding: { order: "input" as const, compression: "store" as const }, stdout: { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } } };
  if (route === "model") {
    const document = await Document(input, textContext); document.settings.odd_and_even_pages_header_footer = true; await document.save(context.stdout);
  } else if (route === "sdk") {
    const result = await editDocumentSections(input, { operation: "sections.set", options: { all: true, evenAndOddHeaders: true, output: "-" } }, context);
    expect(result.changed).toBe(true);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input);
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx sections set /input --all --even-and-odd-headers true --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output"));
    expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output);
  for (const [name, bytes] of parts) if (![setting, "[Content_Types].xml", relationshipName(main)].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  const edges = nodes(xmlStructure(saved.get(relationshipName(main))!)).filter(n => n.name.endsWith("}Relationship"));
  for (const edge of nodes(xmlStructure(parts.get(relationshipName(main))!)).filter(n => n.name.endsWith("}Relationship"))) expect(edges).toContainEqual(edge);
  const settingEdge = edges.filter(edge => edge.attributes["{}Type"] === r + "/settings"); expect(settingEdge).toHaveLength(1);
  const target = decodeURI(new URL(settingEdge[0]!.attributes["{}Target"]!, "https://package.invalid/" + main).pathname.slice(1));
  const part = [...saved].find(([name]) => decodeURI(name) === target)!;
  expect(nodes(xmlStructure(part[1])).filter(node => node.name === "{" + w + "}settings")).toHaveLength(1);
  expect(nodes(xmlStructure(part[1])).filter(n => n.name === "{" + w + "}evenAndOddHeaders")).toHaveLength(1);
  if (existing) { expect(part[0]).toBe(setting); expect(new TextDecoder().decode(part[1])).toContain(opaque); }
  expect((await inspectDocumentSections(output, {}, textContext)).evenAndOddHeaders).toBe(true);
  expect((await Document(output, textContext)).settings.odd_and_even_pages_header_footer).toBe(true);
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const encoded of [false, true]) for (const storyKind of ["headers", "footers"] as const) for (const variant of ["default", "first", "even"] as const) for (const route of ["model", "sdk", "shell"] as const) it(`${route} materializes fresh canonical ${storyKind}/${variant}; ${kind} strict=${strict} encoded=${encoded}`, async () => {
  const { input, parts, main, story, w, r, opaque } = await fixture(strict, kind, encoded, storyKind, variant, true);
  const memory = Volume.fromJSON({ "/output": "" }), key = keys[storyKind][variant];
  const sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/output", bytes); } };
  const batch = { version: 1, operations: [
    { operation: "model.document.Document.sections.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "sections" },
    { operation: "model.section.Section." + key + ".get", receiver: { resultHandle: "sections", index: 1 }, arguments: {}, resultHandle: "story" },
    { operation: "model.section." + (storyKind === "headers" ? "_Header" : "_Footer") + ".is_linked_to_previous.set", receiver: { resultHandle: "story" }, arguments: { value: false } }
  ] };
  if (route === "model") {
    const document = await Document(input, textContext); document.sections[1]![key].is_linked_to_previous = false; await document.save(sink);
  } else if (route === "sdk") {
    const result = await applyStyleModelBatch(input, batch, textContext); expect(result.affected).toBe(1); await result.save(sink);
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops.json", encode(JSON.stringify(batch)));
    const result = await new Shell({ fs }).use(docxCommands({ engine: createDocxInspectionCommandEngine({ limits: textContext.limits }) })).exec("docx batch /input --ops-file /ops.json --output - > /output");
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toBe(""); memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), saved = readPackage(output), sections = (await inspectDocumentSections(output, {}, textContext)).items;
  expect(sections[0]![storyKind][variant].part).toBe("/" + decodeURI(story)); expect(sections[1]![storyKind][variant].linkedToPrevious).toBe(false);
  const local = sections[1]![storyKind][variant].part!; expect(local).not.toBe("/" + decodeURI(story));
  // The model setter creates a fresh definition; utility unlink has its separate copy contract.
  const localPart = [...saved].find(([name]) => "/" + decodeURI(name) === local)!;
  expect(nodes(xmlStructure(localPart[1])).filter(node => node.name === "{" + w + "}p")).toHaveLength(1);
  expect(nodes(xmlStructure(localPart[1])).filter(node => node.name === "{" + w + "}hyperlink")).toHaveLength(0);
  for (const [name, bytes] of parts) if (![main, relationshipName(main), "[Content_Types].xml"].includes(name)) expect(saved.get(name), name).toEqual(bytes);
  expect([...saved.keys()].filter(name => parts.has(name))).toEqual([...parts.keys()]);
  expect(new TextDecoder().decode(saved.get(main))).toContain(opaque);
  const oldEdges = nodes(xmlStructure(parts.get(relationshipName(main))!)).filter(node => node.name.endsWith("}Relationship")), edges = nodes(xmlStructure(saved.get(relationshipName(main))!)).filter(node => node.name.endsWith("}Relationship"));
  for (const edge of oldEdges) expect(edges).toContainEqual(edge);
  expect(edges).toHaveLength(oldEdges.length + 1);
  const created = edges.find(edge => !oldEdges.some(old => old.attributes["{}Id"] === edge.attributes["{}Id"]))!;
  expect(created.attributes["{}Type"]).toBe(r + (storyKind === "headers" ? "/header" : "/footer"));
  expect(decodeURI(new URL(created.attributes["{}Target"]!, "https://package.invalid/" + main).pathname)).toBe(local);
  const reopened = await Document(output, textContext); expect(reopened.sections[1]![key].paragraphs.map(p => p.text)).toEqual([""]);
  expect(reopened.sections[0]![key].paragraphs[0]!.text).toBe("Original link");
});
