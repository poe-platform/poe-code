import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, WD_STYLE_TYPE, StylePartView } from "./index.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";

it("returns an owned part/package graph with keyed relationships and deterministic traversal", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const part = model.styles.part, graph = part.package;
  expect(part.part).toBe(part);
  expect(part.partname.toString()).toBe("/word/styles.xml");
  expect(graph.main_document_part.package).toBe(graph);
  expect(graph.parts).toContain(part);
  expect([...graph.iter_parts()]).toEqual(graph.parts);
  expect([...graph.iter_rels()].some(edge => edge.target_part === part)).toBe(true);
  const main = graph.main_document_part;
  const edge = [...main.rels.values()].find(edge => !edge.is_external && edge.target_part === part)!;
  expect(main.rels.get(edge.rId)).toBe(edge);
  expect(main.rels.at(edge.rId)).toBe(edge);
  expect(main.rels.has(edge.rId)).toBe(true);
  expect([...main.rels]).toContain(edge.rId);
  expect([...main.rels.items()]).toContainEqual([edge.rId, edge]);
  expect(main.related_parts.get(edge.rId)).toBe(part);
  expect(main.target_ref(edge.rId)).toBe(edge.target_ref);
  expect(main.part_related_by(edge.reltype)).toBe(part);
  expect(main.rels.get("missing")).toBeNull();
  expect(() => main.rels.at("missing")).toThrow();
  const bytes = part.blob;
  bytes.fill(0);
  expect(part.blob[0]).toBe(60);
});

it("mutates relationship collections transactionally without following external data", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const part = model.styles.part, rels = part.rels;
  const target = "file:///private/inert.dat";
  const id = rels.get_or_add_ext_rel("urn:notes", target);
  expect(rels.get_or_add_ext_rel("urn:notes", target)).toBe(id);
  const edge = rels.at(id);
  expect(edge.is_external).toBe(true);
  expect(edge.target_ref).toBe(target);
  expect(() => edge.target_part).toThrow();
  expect(rels.related_parts.size).toBe(0);
  expect(rels.xml).toContain("inert.dat");
  expect(rels.copy().get(id)).toBe(edge);
  expect(rels.pop(id)).toBe(edge);
  expect(rels.get(id)).toBeNull();
  expect(() => edge.target_ref).toThrow();
  expect(rels.pop("missing", null)).toBeNull();
  const first = rels.add_relationship("urn:first", "https://invalid.example/data", "rId7", true);
  expect(rels.setdefault("rId7", first)).toBe(first);
  expect(rels.length).toBe(1);
  const other = await openDocumentStyleModel(undefined, textContext);
  expect(() => rels.get_or_add("urn:foreign", other.styles.part)).toThrow();
  expect(rels.length).toBe(1);
  expect(rels.popitem()).toEqual(["rId7", first]);
  expect(rels.length).toBe(0);
  expect(() => rels.popitem()).toThrow();
});

it("preserves cyclic internal traversal and validates dangling graph edits before accepting them", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const graph = model.styles.part.package, main = graph.main_document_part, styles = model.styles.part;
  const id = styles.relate_to(main, "urn:cycle");
  expect(styles.part_related_by("urn:cycle")).toBe(main);
  expect([...graph.iter_parts()].length).toBe(graph.parts.length);
  expect([...graph.iter_rels()].filter(edge => edge.reltype === "urn:cycle")).toHaveLength(1);
  styles.drop_rel(id);
  expect(styles.rels.get(id)).toBeNull();
  const before = [...graph.rels.keys()];
  expect(() => graph.rels.clear()).toThrow();
  expect([...graph.rels.keys()]).toEqual(before);
});

it("renames a live part with content types and incoming/outgoing relationships retained", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const part = model.styles.part, graph = part.package;
  const style = model.styles.add_style("Coast", WD_STYLE_TYPE.PARAGRAPH);
  const id = part.relate_to(graph.main_document_part, "urn:notes");
  part.partname = "/definitions/styles.xml";
  expect(part.partname.toString()).toBe("/definitions/styles.xml");
  expect(part.rels.at(id).target_part).toBe(graph.main_document_part);
  expect(style.part).toBe(part);
  style.font.bold = true;
  const volume = Volume.fromJSON({ "/out": "" });
  await graph.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const reopened = await openDocumentStyleModel(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext);
  expect(reopened.styles.part.partname.toString()).toBe("/definitions/styles.xml");
  expect(reopened.styles.at("Coast").element.children.some(child => child.tag.localName === "rPr")).toBe(true);
  expect(() => part.partname = graph.main_document_part.partname).toThrow();
  expect(part.partname.toString()).toBe("/definitions/styles.xml");
});

it("publishes generic part XML through the existing graph and rejects semantic damage before output", async () => {
  const input = await textFixture(paragraph("Original coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/></w:style></w:styles>` } });
  const model = await openDocumentStyleModel(input, textContext);
  const main = model.styles.part.package.main_document_part;
  const text = main.element.children[0]!.children[0]!.children[0]!.children[0]!;
  text.text = "Revised coast";
  expect(text.text).toBe("Revised coast");
  const sink = { write: vi.fn() };
  const body = main.element.children[0]!;
  expect(() => body.remove()).toThrow();
  await model.save(sink);
  expect(sink.write).toHaveBeenCalled();
  expect(input).toEqual(await textFixture(paragraph("Original coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/></w:style></w:styles>` } }));
});

it("supports relationship assignment/update/default semantics with same-package target rebasing", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const graph = model.styles.part.package, source = model.styles.part.rels, target = graph.main_document_part.rels;
  const edge = source.add_relationship("urn:notes", model.styles.part, "rId9");
  target.set("rId9", edge);
  expect(target.at("rId9").target_part).toBe(model.styles.part);
  expect(target.at("rId9").target_ref).toBe("styles.xml");
  target.update([["rId9", edge]]);
  expect(target.get("missing", edge)).toBe(edge);
  const next = source.add_relationship("urn:extra", graph.main_document_part, "rId10");
  expect(target.setdefault("rId10", next).target_part).toBe(graph.main_document_part);
  expect(target.at("rId10").target_ref).toBe("document.xml");
});

it("captures package graph edits in publication generation guards", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const sink = { write: vi.fn(async () => { model.styles.part.rels.get_or_add_ext_rel("urn:notes", "urn:inert"); }) };
  await expect(model.save(sink)).rejects.toThrow();
  expect(model.styles.part.rels.length).toBe(0);
});

it("rejects graph mutation that overtakes asynchronous serialization without writing a stale snapshot", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const write = vi.fn();
  const pending = model.save({ write });
  model.styles.part.rels.get_or_add_ext_rel("urn:notes", "urn:inert");
  await expect(pending).rejects.toMatchObject({ code: "conflict" });
  expect(write).not.toHaveBeenCalled();
});

it("retains unedited relationship lexical metadata and comments across graph mutation", async () => {
  const { readArchive, writeDocumentArchive } = await import("./index.js");
  const input = await textFixture(paragraph("Coast"));
  const archive = await readArchive(input, textContext);
  const member = archive.members.find(member => member.name === "_rels/.rels")!;
  const original = new TextDecoder().decode(member.bytes).replace("</Relationships>", "<!--Original provenance--></Relationships>");
  const owned = { ...archive, members: archive.members.map(entry => entry === member ? { ...entry, bytes: new TextEncoder().encode(original) } : entry) };
  const volume = Volume.fromJSON({ "/input": "" });
  await writeDocumentArchive(owned, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  const model = await openDocumentStyleModel(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  model.styles.part.package.rels.get_or_add_ext_rel("urn:notes", "urn:inert");
  expect(model.styles.part.package.rels.xml).toContain("<!--Original provenance-->");
});

it("changes relationship type, target and external mode in one transactional assignment", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const source = model.styles.part.rels, target = model.package.main_document_part.rels;
  const internal = target.add_relationship("urn:original", model.styles.part, "rId90");
  const external = source.add_relationship("urn:revised", "urn:inert", "rId90", true);
  target.set("rId90", external);
  expect(internal.reltype).toBe("urn:revised");
  expect(internal.target_ref).toBe("urn:inert");
  expect(internal.is_external).toBe(true);
  source.delete("rId90");
  const owned = source.add_relationship("urn:owned", model.styles.part, "rId90");
  target.set("rId90", owned);
  expect(internal.reltype).toBe("urn:owned");
  expect(internal.target_part).toBe(model.styles.part);
  expect(internal.is_external).toBe(false);
});

it("returns the existing style domain from its live part view", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  expect(model.styles.part.styles).toBe(model.styles);
  expect(StylePartView.default(model.package)).not.toBe(model.styles.part);
  const style = model.styles.part.styles.add_style("Harbor", WD_STYLE_TYPE.CHARACTER);
  expect(model.styles.at("Harbor").equals(style)).toBe(true);
});

it("exercises package and part relationship hooks, uniqueness, clearing and explicit pop fallbacks", async () => {
  const model = await openDocumentStyleModel(undefined, textContext), graph = model.package, part = model.styles.part;
  const reltype = "urn:original-notes";
  const id = graph.relate_to(part, reltype);
  expect(graph.part_related_by(reltype)).toBe(part);
  expect(graph.relate_to(part, reltype)).toBe(id);
  graph.load_rel("urn:load", "urn:inert", "rId99", true);
  expect(graph.rels.at("rId99").target_ref).toBe("urn:inert");
  part.load_rel("urn:notes", graph.main_document_part, "rId8");
  const edge = part.rels.at("rId8");
  expect(part.rels.get_or_add("urn:notes", graph.main_document_part)).toBe(edge);
  part.rels.add_relationship("urn:notes", part, "rId9");
  expect(() => part.part_related_by("urn:notes")).toThrow();
  expect(() => part.rels.pop("missing")).toThrow();
  expect(part.rels.pop("missing", edge)).toBe(edge);
  part.rels.clear();
  expect(part.rels.length).toBe(0);
  expect(() => edge.rId).toThrow();
  expect(() => part.rels.delete("missing")).toThrow();
});
