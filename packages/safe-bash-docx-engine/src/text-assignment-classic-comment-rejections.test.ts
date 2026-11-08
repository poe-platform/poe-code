import { Volume } from "memfs";
import { it } from "vitest";
import * as api from "./index.js";
import { runElementOpen } from "./run-properties.js";
import { fixture, variants } from "../tests/fixtures/native-text-raster.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
for (const dialect of ["strict", "transitional"] as const) for (const kind of ["docx", "dotx"] as const)
for (const variant of ["missing-id", "noninteger-id", "opaque-attribute", "reference-children", "missing-target", "duplicate-target", "linked-target", "missing-relationship"] as const)
for (const target of ["paragraph", "cell"] as const) for (const route of ["model", "direct"] as const)
it.concurrent(`destructive text refuses unsafe classic references without mutation; ${dialect}; ${kind}; ${variant}; ${target}; ${route}`, async ({ expect }) => {
  const m = Volume.fromJSON({ "/authored": "", "/input": "", "/output": "", "/destination": "Retained destination" }), sink = (name: string) => ({ async write(bytes: Uint8Array) { m.appendFileSync(name, bytes); } }), ctx = { ...textContext, timestamp: new Date("2026-01-02T03:04:06Z") };
  const authored = await api.Document(await fixture(dialect, kind, variants[0]!), ctx), s = authored.sections[0]!; s.page_width = api.Inches(8); s.left_margin = api.Inches(1); s.right_margin = api.Inches(1);
  const p = target === "cell" ? authored.add_table(1, 1).cell(0, 0).paragraphs[0]! : authored.paragraphs[0]!, anchor = p.add_run("Native anchor 日本 עברית 🌊"), comment = authored.add_comment(anchor, "Retain comment"), comments = comment.paragraphs[0]!.part.partname.toString().slice(1);
  await authored.save(sink("/authored")); const parts = readPackage(new Uint8Array(m.readFileSync("/authored") as Buffer)), xml = new api.DocumentXmlEditor(parts.get("word/document.xml")!), all = (node: api.XmlElement): api.XmlElement[] => [node, ...node.children.flatMap(all)], reference = all(xml.root).find(node => node.localName === "commentReference")!;
  if (["missing-id", "noninteger-id", "opaque-attribute", "reference-children"].includes(variant)) {
    const attributes = variant === "missing-id" ? reference.attributes.filter(attribute => attribute.localName !== "id") : variant === "noninteger-id" ? reference.attributes.map(attribute => attribute.localName === "id" ? { ...attribute, value: "bad" } : attribute) : variant === "opaque-attribute" ? [...reference.attributes, { name: "f:owned", namespace: "urn:original:unsafe-reference", localName: "owned", value: "retain" }, { name: "mc:Ignorable", namespace: "http://schemas.openxmlformats.org/markup-compatibility/2006", localName: "Ignorable", value: "f" }] : reference.attributes;
    const node = { ...reference, namespaces: new Map([...reference.namespaces, ["f", "urn:original:unsafe-reference"], ["mc", "http://schemas.openxmlformats.org/markup-compatibility/2006"]]), attributes };
    parts.set("word/document.xml", new TextEncoder().encode(xml.sourceXml(xml.root, new Map([[reference, runElementOpen(node) + (variant === "reference-children" ? `<f:owned xmlns:f="urn:original:unsafe-reference"/>` : "") + `</${reference.name}>`]]))));
  } else if (variant === "missing-target" || variant === "duplicate-target") {
    const editor = new api.DocumentXmlEditor(parts.get(comments)!), node = editor.root.children[0]!;
    parts.set(comments, new TextEncoder().encode(runElementOpen(editor.root) + (variant === "duplicate-target" ? editor.sourceXml(node).repeat(2) : "") + `</${editor.root.name}>`));
  } else {
    const editor = new api.DocumentXmlEditor(parts.get("word/_rels/document.xml.rels")!), edge = editor.root.children.find(node => node.attributes.some(attribute => attribute.localName === "Type" && attribute.value.endsWith("/comments")))!;
    const node = { ...edge, attributes: [...edge.attributes.map(attribute => attribute.localName === "Target" ? { ...attribute, value: "https://invalid.example/inert-comments" } : attribute), { name: "TargetMode", namespace: "", localName: "TargetMode", value: "External" }] };
    parts.set("word/_rels/document.xml.rels", new TextEncoder().encode(editor.sourceXml(editor.root, new Map([[edge, variant === "missing-relationship" ? "" : runElementOpen(node) + `</${edge.name}>`]]))));
  }
  await api.writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) => ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) }, sink("/input"), { order: "input", compression: "store" }, ctx);
  const input = new Uint8Array(m.readFileSync("/input") as Buffer);
  if (route === "model" && variant === "linked-target") await expect(api.Document(input, ctx)).rejects.toMatchObject({ code: "invalid-package" });
  else if (route === "model") { const doc = await api.Document(input, ctx), before = doc.part.blob; expect(() => { if (target === "cell") doc.tables[0]!.cell(0, 0).text = "Refused"; else doc.paragraphs[0]!.text = "Refused"; }).toThrowError(expect.objectContaining({ code: "unsupported-edit" })); expect(doc.part.blob).toEqual(before); }
  else {
    const context = { ...ctx, encoding: { order: "input" as const, compression: "store" as const }, stdout: sink("/output") };
    const edit = target === "cell" ? api.editDocumentTables(input, { operation: "tables.set", options: { table: 1, cell: "A1", text: "Refused", output: "-" } }, context) : api.editDocumentParagraphs(input, { operation: "paragraphs.set", options: { paragraph: 1, text: "Refused", output: "-" } }, context);
    await expect(edit).rejects.toMatchObject({ code: ["opaque-attribute", "reference-children"].includes(variant) ? "unsupported-edit" : "invalid-package" });
  }
  expect(m.readFileSync("/output").length).toBe(0); expect(new Uint8Array(m.readFileSync("/input") as Buffer)).toEqual(input); expect(m.readFileSync("/destination", "utf8")).toBe("Retained destination");
});
