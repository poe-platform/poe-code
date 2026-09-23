import { Volume } from "memfs";
import { expect, it } from "vitest";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage, xmlStructure } from "../tests/assertions.js";

const enc = (value: string) => new TextEncoder().encode(value), ref = (resultHandle: string, key?: string) => ({ resultHandle, ...(key === undefined ? {} : { key }) });
const wordType = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
const owners = [
  ["parts.document.DocumentPart", api.DocumentPartView, "document.main", "document"],
  ["parts.story.StoryPart", api.StoryPart, "header", "hdr"],
  ["parts.hdrftr.HeaderPart", api.HeaderPart, "header", "hdr"],
  ["parts.hdrftr.FooterPart", api.FooterPart, "footer", "ftr"],
  ["parts.comments.CommentsPart", api.CommentsPart, "comments", "comments"],
  ["parts.settings.SettingsPart", api.SettingsPart, "settings", "settings"],
  ["parts.styles.StylesPart", api.StylesPart, "styles", "styles"],
  ["parts.numbering.NumberingPart", api.NumberingPart, "numbering", "numbering"],
  ["opc.parts.coreprops.CorePropertiesPart", api.CorePropertiesPartView, "core", "coreProperties"],
  ["parts.image.ImagePart", api.ImagePartView, "image", ""]
] as const;
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const [owner, Factory, role, root] of owners) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} executes inherited package reads, hooks, edges and rename on ${owner}; strict=${strict}; kind=${kind}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p><w:r><w:t>Original owner</w:t></w:r></w:p>");
  const word = strict ? "http://purl.oclc.org/ooxml/wordprocessingml/main" : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const type = role === "core" ? "application/vnd.openxmlformats-package.core-properties+xml" : role === "image" ? "image/png" : wordType + role + "+xml";
  const payload = role === "image" ? rasterPng() : enc(`<?xml version="1.0"?><!--owned--><n:${root} xmlns:n="${role === "core" ? "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" : word}">${root === "document" ? "<n:body><n:p/></n:body>" : ""}<!--retained--></n:${root}>`);
  const name = "/audit/owned." + (role === "image" ? "png" : "xml"), renamed = "/moved/owned." + (role === "image" ? "png" : "xml"), prefix = "model." + owner;
  const memory = Volume.fromJSON({ "/input": Buffer.from(input), "/output": "" });
  const operations: { operation: string; receiver?: ReturnType<typeof ref>; arguments: Record<string, unknown>; resultHandle?: string }[] = [
    { operation: "model.document.Document.part.get", receiver: ref("document"), arguments: {}, resultHandle: "main" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: ref("main"), arguments: {}, resultHandle: "package" },
    { operation: prefix + ".load.call", arguments: { partname: name, contentType: type, blob: { kind: "bytes", base64: Buffer.from(payload).toString("base64") }, ownerPackage: ref("package") }, resultHandle: "native" }
  ];
  const expected = new Map<number, unknown>();
  const invoke = (member: string, args: Record<string, unknown> = {}, resultHandle?: string) => {
    operations.push({ operation: prefix + "." + member, receiver: ref("native"), arguments: args, ...(resultHandle ? { resultHandle } : {}) });
    return operations.length - 1;
  };
  expected.set(invoke("after_unmarshal.call"), null); expected.set(invoke("before_marshal.call"), null);
  expected.set(invoke("blob.get"), { kind: "bytes", base64: Buffer.from(payload).toString("base64") });
  expected.set(invoke("content_type.get"), type); expected.set(invoke("partname.get"), name);
  invoke("package.get", {}, "nativePackage");
  operations.push({ operation: "model.package.Package.main_document_part.get", receiver: ref("nativePackage"), arguments: {}, resultHandle: "sameMain" });
  operations.push({ operation: "model.parts.document.DocumentPart.partname.get", receiver: ref("sameMain"), arguments: {} }); expected.set(operations.length - 1, "/word/document.xml");
  if (role !== "image") {
    invoke("element.get", {}, "element");
    operations.push({ operation: "model.XmlElementView.tag.get", receiver: ref("element"), arguments: {} });
    expected.set(operations.length - 1, { namespaceURI: role === "core" ? "http://schemas.openxmlformats.org/package/2006/metadata/core-properties" : word, localName: root });
    invoke("part.get", {}, "samePart");
    operations.push({ operation: prefix + ".partname.get", receiver: ref("samePart"), arguments: {} }); expected.set(operations.length - 1, name);
  }
  expected.set(invoke("related_parts.get"), []);
  invoke("rels.get", {}, "rels");
  operations.push({ operation: "model.opc.rel.Relationships.__len__.get", receiver: ref("rels"), arguments: {} }); expected.set(operations.length - 1, 0);
  expected.set(invoke("load_rel.call", { reltype: "urn:coastal:external", target: "../coast?view=1#bay", rId: "external", isExternal: true }), null);
  expected.set(invoke("relate_to.call", { target: "../coast?view=1#bay", reltype: "urn:coastal:external", isExternal: true }), "external");
  expected.set(invoke("relate_to.call", { target: ref("main"), reltype: "urn:coastal:internal" }), "rId1");
  expected.set(invoke("target_ref.call", { rId: "rId1" }), "../word/document.xml");
  invoke("part_related_by.call", { reltype: "urn:coastal:internal" }, "related");
  operations.push({ operation: "model.parts.document.DocumentPart.partname.get", receiver: ref("related"), arguments: {} }); expected.set(operations.length - 1, "/word/document.xml");
  const mapIndex = invoke("related_parts.get", {}, "relatedMap");
  operations.push({ operation: "model.parts.document.DocumentPart.partname.get", receiver: ref("relatedMap", "rId1"), arguments: {} });
  expected.set(operations.length - 1, "/word/document.xml");
  invoke("partname.set", { value: renamed }); expected.set(invoke("partname.get"), renamed);
  expected.set(invoke("target_ref.call", { rId: "external" }), "../coast?view=1#bay");
  expected.set(invoke("drop_rel.call", { rId: "rId1" }), null); expected.set(invoke("related_parts.get"), []);
  if (route === "model") {
    const doc = await api.Document(input, textContext), part = await Factory.load(name, type, payload, doc.part.package);
    expect(part).toBeInstanceOf(Factory); expect(part.package).toBe(doc.part.package);
    expect(part.after_unmarshal()).toBeUndefined(); expect(part.before_marshal()).toBeUndefined();
    expect(part.blob).toEqual(payload); const owned = part.blob; owned.fill(0); expect(part.blob).toEqual(payload);
    expect(part.content_type).toBe(type); expect(String(part.partname)).toBe(name);
    if (part instanceof api.XmlPartView) { expect(part.part).toBe(part); expect(part.element.tag.localName).toBe(root); }
    expect(part.rels.length).toBe(0); expect(part.related_parts.size).toBe(0);
    expect(part.load_rel("urn:coastal:external", "../coast?view=1#bay", "external", true)).toBeUndefined();
    expect(part.relate_to("../coast?view=1#bay", "urn:coastal:external", true)).toBe("external");
    expect(part.relate_to(doc.part, "urn:coastal:internal")).toBe("rId1"); expect(part.target_ref("rId1")).toBe("../word/document.xml");
    expect(part.part_related_by("urn:coastal:internal")).toBe(doc.part); expect([...part.related_parts]).toEqual([["rId1", doc.part]]);
    const relationships = part.rels; part.partname = renamed; expect([...part.rels]).toEqual([...relationships]); expect(relationships.at("external").target_ref).toBe("../coast?view=1#bay"); expect(String(part.partname)).toBe(renamed);
    expect(part.target_ref("external")).toBe("../coast?view=1#bay"); expect(part.drop_rel("rId1")).toBeUndefined(); expect(part.related_parts.size).toBe(0);
    await doc.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else if (route === "sdk") {
    const result = await api.applyStyleModelBatch(input, { version: 1, operations }, textContext);
    for (const [index, value] of expected) expect(result.results[index]!.value, operations[index]!.operation).toEqual(value);
    expect(result.results[mapIndex]!.value).toEqual([{ key: "rId1", value: expect.objectContaining({ type: "DocumentPart" }) }]);
    await result.save({ async write(bytes) { memory.appendFileSync("/output", bytes); } });
  } else {
    const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); await fs.writeFile("/ops", enc(JSON.stringify({ version: 1, operations })));
    const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits: textContext.limits }) }));
    try {
      const response = await shell.exec("docx batch /input --ops-file /ops --output /output --json"); expect(response.exitCode, response.stdout + response.stderr).toBe(0);
      const result = JSON.parse(response.stdout); for (const [index, value] of expected) expect(result.data.results[index].data, operations[index]!.operation).toEqual(value);
      expect(result.data.results[mapIndex].data).toEqual([{ key: "rId1", value: expect.objectContaining({ type: "DocumentPart" }) }]);
      memory.writeFileSync("/output", await fs.readFile("/output")); expect(await fs.readFile("/input")).toEqual(input);
    } finally { await shell.dispose(); }
  }
  const saved = readPackage(new Uint8Array(memory.readFileSync("/output") as Buffer));
  for (const [member, bytes] of readPackage(input)) if (member !== "[Content_Types].xml") expect(saved.get(member), member).toEqual(bytes);
  expect(saved.get(renamed.slice(1))).toEqual(payload); expect(saved.has(name.slice(1))).toBe(false); expect(saved.has("audit/_rels/owned." + (role === "image" ? "png" : "xml") + ".rels")).toBe(false);
  const rels = xmlStructure(saved.get("moved/_rels/owned." + (role === "image" ? "png" : "xml") + ".rels")!);
  const nodes = (node: ReturnType<typeof xmlStructure>): ReturnType<typeof xmlStructure>[] => [node, ...node.children.flatMap(child => typeof child === "string" ? [] : nodes(child))];
  const edge = nodes(rels).filter(node => node.name === "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"); expect(edge).toHaveLength(1); expect(edge[0]!.attributes).toMatchObject({ "{}Id": "external", "{}Target": "../coast?view=1#bay", "{}TargetMode": "External" });
  expect(memory.readFileSync("/input")).toEqual(Buffer.from(input));
});
