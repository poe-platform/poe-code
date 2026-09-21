import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { runElementOpen } from "./run-properties.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { readPackage } from "../tests/assertions.js";
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const carrier of ["direct", "choice", "fallback", "process"] as const) for (const lexical of [false, true])
for (const target of ["paragraph", "cell"] as const) for (const clear of [false, true]) for (const route of ["model", "direct"] as const)
it.concurrent(`destructive text retains classic comment anchors and linked references; ${dialect}; ${kind}; ${target}; clear=${clear}; ${route}${carrier === "direct" ? "" : "; targetCarrier=" + carrier}${lexical ? "; lexical=true" : ""}`, async () => {
  const memory = Volume.fromJSON({ "/input": "", "/output": "" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { memory.appendFileSync(name, bytes); } });
  const context = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") }, doc = await api.Document(await fixture(dialect, kind, variants[0]!), context);
  const s = doc.sections[0]!; s.page_width = api.Inches(8); s.left_margin = api.Inches(1); s.right_margin = api.Inches(1);
  const p = target === "cell" ? doc.add_table(1, 1).cell(0, 0).paragraphs[0]! : doc.paragraphs[0]!;
  const anchor = p.add_run("Classic anchor 日本 עברית 🌊");
  if (target === "cell") await p.add_run().add_picture(rasterPng());
  p.alignment = api.WD_ALIGN_PARAGRAPH.RIGHT;
  const comment = doc.add_comment(anchor, "Preserved classic comment", "Original author", "OA"), id = comment.comment_id;
  await doc.save(sink("/input"));
  const authored = readPackage(new Uint8Array(memory.readFileSync("/input") as Buffer));
  if (carrier !== "direct") {
    const name = comment.paragraphs[0]!.part.partname.toString().slice(1), xml = new api.DocumentXmlEditor(authored.get(name)!), node = xml.root.children[0]!, raw = xml.sourceXml(node), inactive = '<f:sealed>Retain target é 日本 עברית 🌊</f:sealed>', mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    const wrapped = carrier === "process" ? `<f:pass>${raw}</f:pass>${inactive}` : `<mc:AlternateContent><mc:Choice Requires="${carrier === "choice" ? "w" : "f"}">${carrier === "choice" ? raw : inactive}</mc:Choice><mc:Fallback>${carrier === "fallback" ? raw : inactive}</mc:Fallback></mc:AlternateContent>`;
    const root = { ...xml.root, namespaces: new Map([...xml.root.namespaces, ["w", xml.root.namespace], ["f", "urn:original:comment-target"], ["mc", mc]]), attributes: [...xml.root.attributes, { name: "mc:Ignorable", namespace: mc, localName: "Ignorable", value: "f" }, { name: "mc:ProcessContent", namespace: mc, localName: "ProcessContent", value: "f:pass" }] };
    authored.set(name, new TextEncoder().encode(runElementOpen(root) + xml.sourceXml(xml.root, new Map([[node, wrapped]]), true) + `</${xml.root.name}>`));
  }
  if (lexical) {
    const xml = new api.DocumentXmlEditor(authored.get("word/document.xml")!), descendants = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(descendants)], node = descendants(xml.root).find(node => node.localName === "commentReference")!;
    const ref = { ...node, attributes: node.attributes.map(attribute => attribute.namespace === node.namespace && attribute.localName === "id" ? { ...attribute, value: "00" } : attribute) };
    authored.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[node, runElementOpen(ref) + `</${node.name}>`]]))));
  }
  memory.writeFileSync("/input", "");
  await api.writeArchive({ comment: new Uint8Array(), members: [...authored].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, context);
  const input = new Uint8Array(memory.readFileSync("/input") as Buffer), before = readPackage(input), value = clear ? "" : "Replaced é 日本 עברית 🌊";
  if (route === "model") {
    const reopened = await api.Document(input, context);
    if (target === "cell") reopened.tables[0]!.cell(0, 0).text = value;
    else if (clear) reopened.paragraphs[0]!.clear(); else reopened.paragraphs[0]!.text = value;
    await reopened.save(sink("/output"));
  } else {
    const write = { ...context, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
    if (target === "cell") await api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: value, output: "-" } }, write);
    else await api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: value, output: "-" } }, write);
  }
  const output = new Uint8Array(memory.readFileSync("/output") as Buffer), after = readPackage(output);
  for (const [name, bytes] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes);
  const reopened = await api.Document(output, context), changed = target === "cell" ? reopened.tables[0]!.cell(0, 0).paragraphs[0]! : reopened.paragraphs[0]!;
  expect(changed.text).toBe(value);
  if (target === "cell") { expect(changed.runs).toHaveLength(1); expect(changed.runs[0]!.bold).toBe(null); expect(changed.runs[0]!.font.rtl).toBe(null); } expect(reopened.comments.get(id)!.text).toBe("Preserved classic comment");
  const root = api.parseDocumentXml(after.get("word/document.xml")!, {}).root, descendants = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(descendants)];
  for (const name of ["commentRangeStart", "commentRangeEnd", "commentReference"]) {
    const nodes = descendants(root).filter(node => node.namespace === root.namespace && node.localName === name);
    expect(nodes).toHaveLength(1); expect(nodes[0]!.attributes.find(attribute => attribute.namespace === root.namespace && attribute.localName === "id")!.value).toBe(name === "commentReference" && lexical ? "00" : String(id));
  }
  expect((await api.validateDocument(output, context)).valid).toBe(true);
  expect(new Uint8Array(memory.readFileSync("/input") as Buffer)).toEqual(input);
});
