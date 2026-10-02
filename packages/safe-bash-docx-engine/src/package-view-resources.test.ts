import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, PartView, XmlPartView, WD_STYLE_TYPE } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("admits original binary and XML parts asynchronously with owned bytes and graph publication", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const graph = model.styles.part.package;
  const input = new Uint8Array([11, 22, 33]);
  const pending = PartView.load("/data/notes.bin", "application/octet-stream", input, graph);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  input.fill(0);
  expect(part.blob).toEqual(new Uint8Array([11, 22, 33]));
  graph.main_document_part.relate_to(part, "urn:notes");
  const xml = await XmlPartView.load("/data/tree.xml", "application/xml", new TextEncoder().encode('<tree xmlns="urn:tree"><leaf>Original</leaf></tree>'), graph);
  graph.main_document_part.relate_to(xml, "urn:tree");
  xml.element.children[0]!.text = "Revised";
  expect(xml.element.children[0]!.text).toBe("Revised");
  const volume = Volume.fromJSON({ "/out": "" });
  await graph.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  expect(volume.statSync("/out").size).toBeGreaterThan(0);
  await expect(XmlPartView.load("/data/invalid.xml", "application/xml", new TextEncoder().encode('<!DOCTYPE tree><tree/>'), graph)).rejects.toThrow();
  await expect(PartView.load("/data/notes.bin", "application/octet-stream", new Uint8Array(), graph)).rejects.toThrow();
});

it("returns live package core properties with neutral spellings, scalar validation and owned dates", async () => {
  const model = await openDocumentStyleModel(undefined, { ...textContext, timestamp: new Date("2024-02-29T12:34:56.999Z"), author: "Field observer" });
  const properties = model.styles.part.package.core_properties;
  for (const key of ["title", "subject", "author", "keywords", "comments", "last_modified_by", "category", "content_status", "identifier", "language", "version"] as const) {
    properties[key] = "潮 🌿";
    expect(properties[key]).toBe("潮 🌿");
    expect(() => { properties[key] = null as never; }).toThrow();
    expect(() => { properties[key] = "🌿".repeat(256); }).toThrow();
  }
  for (const key of ["created", "modified", "last_printed"] as const) {
    const date = new Date("1969-12-31T23:59:59.999Z");
    properties[key] = date;
    date.setTime(0);
    expect(properties[key]!.toISOString()).toBe("1969-12-31T23:59:59.000Z");
    properties[key]!.setTime(0);
    expect(properties[key]!.toISOString()).toBe("1969-12-31T23:59:59.000Z");
    expect(() => { properties[key] = new Date(NaN); }).toThrow();
  }
  properties.revision = 2;
  expect(properties.revision).toBe(2);
  expect(() => { properties.revision = 0; }).toThrow();
  expect(properties.part.package).toBe(model.styles.part.package);
  expect(properties.element.tag.localName).toBe("coreProperties");
});

it("exposes image-part collections with async admission, deduplication and per-axis sizing", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const graph = model.styles.part.package, parts = graph.image_parts;
  expect(parts.length).toBe(0);
  const input = rasterPng(10, 20);
  const pending = graph.get_or_add_image_part(input);
  expect(pending).toBeInstanceOf(Promise);
  const part = await pending;
  expect(await parts.get_or_add_image_part(input)).toBe(part);
  expect(parts.has(part)).toBe(true);
  expect([...parts]).toEqual([part]);
  expect(part.image.px_width).toBe(10);
  expect(part.image.px_height).toBe(20);
  expect(part.default_cx.emu).toBe(part.image.width.emu);
  expect(part.default_cy.emu).toBe(part.image.height.emu);
  expect(part.sha1).toBe(part.image.sha1);
  expect(part.filename).toBe("image.png");
  parts.append(part);
  expect(parts.length).toBe(1);
  const other = await openDocumentStyleModel(undefined, textContext);
  expect(() => other.package.image_parts.append(part)).toThrow();
  graph.main_document_part.relate_to(part, "urn:original-image");
  const volume = Volume.fromJSON({ "/out": "" });
  await model.save({ async write(bytes) { volume.appendFileSync("/out", bytes); } });
  const reopened = await openDocumentStyleModel(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext);
  expect(reopened.package.image_parts.length).toBe(1);
  expect([...reopened.package.image_parts][0]!.image.px_width).toBe(10);
});

it("retains default-based content types when renaming to a different extension", async () => {
  const { readArchive, writeDocumentArchive } = await import("./index.js");
  const { textFixture, paragraph } = await import("../tests/fixtures/text.js");
  const archive = await readArchive(await textFixture(paragraph("Coast")), textContext);
  const types = archive.members.find(member => member.name === "[Content_Types].xml")!;
  const content = new TextDecoder().decode(types.bytes).replace("</Types>", '<Default Extension="bin" ContentType="application/octet-stream"/></Types>');
  const owned = { ...archive, members: [...archive.members.map(member => member === types ? { ...member, bytes: new TextEncoder().encode(content) } : member), { name: "data/notes.bin", bytes: Uint8Array.of(5), directory: false, modified: new Date(0) }] };
  const volume = Volume.fromJSON({ "/input": "" });
  await writeDocumentArchive(owned, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  const model = await openDocumentStyleModel(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  const part = [...model.package.main_document_part.package.image_parts];
  expect(part).toEqual([]);
  // Establish reachability through the original binary payload.
  const graph = model.package;
  const binary = new PartView(graph, "/data/notes.bin");
  graph.main_document_part.relate_to(binary, "urn:notes");
  binary.partname = "/data/notes.dat";
  expect(binary.content_type).toBe("application/octet-stream");
  expect(binary.blob).toEqual(Uint8Array.of(5));
});

it("reports oversized part admission with the shared resource-limit error", async () => {
  const { ResourceLimitError } = await import("./index.js");
  const model = await openDocumentStyleModel(undefined, textContext);
  await expect(PartView.load("/data/large.bin", "application/octet-stream", new Uint8Array(textContext.limits.maxEntryBytes + 1), model.package)).rejects.toBeInstanceOf(ResourceLimitError);
});

it("opens package factories over the existing live editor and validates explicit sink publication", async () => {
  const { PackageView } = await import("./index.js");
  const { textFixture, paragraph } = await import("../tests/fixtures/text.js");
  const input = await textFixture(paragraph("Coast"));
  const graph = await PackageView.open(input, textContext);
  input.fill(0);
  expect(graph.main_document_part.element.tag.localName).toBe("document");
  graph.after_unmarshal();
  graph.main_document_part.before_marshal();
  graph.main_document_part.after_unmarshal();
  await expect(graph.save(null as never)).rejects.toThrow();
  await expect(PackageView.open("/ambient.docx" as never)).rejects.toThrow();
});

it("loads characterized image parts and core-properties defaults into the admitted owner", async () => {
  const { Image, ImagePartView, CorePropertiesPartView } = await import("./index.js");
  const model = await openDocumentStyleModel(undefined, textContext);
  expect(typeof ImagePartView.from_image).toBe("function");
  expect(typeof CorePropertiesPartView.default).toBe("function");
  const bytes = rasterPng(3, 4);
  const part = await ImagePartView.load("/word/media/original.png", "image/png", bytes, model.package);
  expect(part).toBeInstanceOf(ImagePartView);
  expect(part.image.px_height).toBe(4);
  await expect(ImagePartView.load("/word/media/bad.png", "image/jpeg", bytes, model.package)).rejects.toThrow();
  const image = await Image.from_blob(bytes, textContext);
  const imported = await ImagePartView.from_image(image, "/word/media/imported.png", model.package);
  expect(imported.image.px_width).toBe(3);
  const core = CorePropertiesPartView.default(model.package);
  expect(core.core_properties).toBe(model.package.core_properties);
  expect(CorePropertiesPartView.default(model.package)).toBe(core);
});

it("keeps inert uncharacterizable declared images available as owned package payloads", async () => {
  const { readArchive, writeDocumentArchive } = await import("./index.js");
  const { textFixture, paragraph } = await import("../tests/fixtures/text.js");
  const archive = await readArchive(await textFixture(paragraph("Coast")), textContext);
  const types = archive.members.find(member => member.name === "[Content_Types].xml")!;
  const content = new TextDecoder().decode(types.bytes).replace("</Types>", '<Override PartName="/word/media/inert.png" ContentType="image/png"/></Types>');
  const owned = { ...archive, members: [...archive.members.map(member => member === types ? { ...member, bytes: new TextEncoder().encode(content) } : member), { name: "word/media/inert.png", bytes: Uint8Array.of(5), directory: false, modified: new Date(0) }] };
  const volume = Volume.fromJSON({ "/input": "" });
  await writeDocumentArchive(owned, { async write(bytes) { volume.appendFileSync("/input", bytes); } }, { compression: "store", order: "input" }, textContext);
  const model = await openDocumentStyleModel(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  const part = [...model.package.image_parts][0]!;
  expect(part.blob).toEqual(Uint8Array.of(5));
  expect(() => part.image).toThrow();
  model.styles.add_style("Coast", WD_STYLE_TYPE.PARAGRAPH).font.bold = true;
  await model.save({ async write() {} });
});

it("rejects XML part growth beyond the admitted entry ceiling before accepting a write", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const part = await XmlPartView.load("/data/tree.xml", "application/xml", new TextEncoder().encode("<tree>Original</tree>"), model.package);
  expect(() => { part.element.text = "x".repeat(textContext.limits.maxEntryBytes); }).toThrow();
  expect(part.element.text).toBe("Original");
});

it("does not stage a part that exceeds the explicit path ceiling", async () => {
  const model = await openDocumentStyleModel(undefined, textContext), graph = model.package;
  const revision = graph.revision;
  await expect(PartView.load("/data/" + "x".repeat(textContext.limits.maxPathBytes) + ".bin", "application/octet-stream", Uint8Array.of(1), graph)).rejects.toThrow();
  expect(graph.revision).toBe(revision);
});
