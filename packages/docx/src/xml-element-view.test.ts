import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentStyleModel, WD_STYLE_TYPE, applyStyleModelBatch } from "./index.js";
import { textContext, textFixture, paragraph, w } from "../tests/fixtures/text.js";

const name = (localName: string) => ({ namespaceURI: w, localName });
const ref = (resultHandle: string, index?: number) => ({ resultHandle, ...(index === undefined ? {} : { index }) });

it("returns live bounded XML tags, attribute snapshots and ordered child owners", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Tidal mark", WD_STYLE_TYPE.CHARACTER);
  const element = style.element;
  expect(element.tag).toEqual(name("style"));
  expect([...element.attributes].map(([key, value]) => [key.localName, value])).toContainEqual(["styleId", style.style_id]);
  expect(element.children[0]!.tag).toEqual(name("name"));
  element.set_attribute(name("styleId"), "Tidal");
  expect(style.style_id).toBe("Tidal");
  style.name = "New tidal mark";
  expect(element.children[0]!.attributes.values().next().value).toBe("New tidal mark");
  const attributes = element.attributes as Map<{ namespaceURI: string; localName: string }, string>;
  attributes.clear();
  expect(element.attributes.size).toBeGreaterThan(0);
});

it("adds and removes qualified attributes without exposing namespace mutation", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Canopy", WD_STYLE_TYPE.PARAGRAPH);
  style.element.set_attribute(name("customStyle"), null);
  expect(style.builtin).toBe(true);
  style.element.set_attribute(name("customStyle"), "1");
  expect(style.builtin).toBe(false);
  expect(() => style.element.set_attribute({ namespaceURI: "http://www.w3.org/2000/xmlns/", localName: "w" }, "changed")).toThrow();
  expect(() => style.element.set_attribute({ namespaceURI: w, localName: "bad:name" }, "x")).toThrow();
});

it("inserts original structured nodes, preserves sibling handles, and invalidates removal", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Canopy", WD_STYLE_TYPE.PARAGRAPH);
  const first = style.element.children[0]!;
  const added = style.element.insert(0, { kind: "element", name: name("aliases"), attributes: [{ name: name("val"), value: "Meadow & coast" }] });
  expect(added.tag).toEqual(name("aliases"));
  expect(first.tag).toEqual(name("name"));
  expect(style.element.children.map(child => child.tag.localName)).toEqual(["aliases", "name"]);
  added.remove();
  expect(() => added.tag).toThrow();
  expect(first.tag.localName).toBe("name");
  expect(() => style.element.insert(-1, { kind: "element", name: name("b") })).toThrow();
  expect(() => style.element.insert(0, added as never)).toThrow();
});

it("reads and writes leading text and tail without deleting mixed content", async () => {
  const bytes = await textFixture(paragraph("Coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Coast"><w:name w:val="Coast"/>  <w:aliases w:val="shore"/>\n</w:style></w:styles>` } });
  const model = await openDocumentStyleModel(bytes, textContext);
  const element = model.styles.at("Coast").element;
  expect(element.text).toBeNull();
  const first = element.children[0]!;
  expect(first.tail).toBe("  ");
  first.tail = "\n ";
  expect(first.tail).toBe("\n ");
  first.tail = null;
  expect(first.tail).toBeNull();
  element.text = "\n";
  expect(element.text).toBe("\n");
  expect(element.children.length).toBe(2);
  element.text = null;
  expect(element.text).toBeNull();
  expect(() => { element.text = "\0"; }).toThrow();
  expect(element.children.length).toBe(2);
});

it("invalidates retained XML and descendants after owner deletion and name recreation", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Coast", WD_STYLE_TYPE.PARAGRAPH);
  const root = style.element, child = root.children[0]!;
  style.delete();
  model.styles.add_style("Coast", WD_STYLE_TYPE.PARAGRAPH);
  for (const view of [root, child]) {
    expect(() => view.tag).toThrow();
    expect(() => view.serialize()).toThrow();
    expect(() => view.set_attribute(name("val"), "x")).toThrow();
  }
});

it("publishes owned XML changes through the existing model and rejects invalid graphs", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Coast", WD_STYLE_TYPE.CHARACTER);
  const bytes = style.element.serialize();
  bytes.fill(0);
  expect(style.element.serialize()[0]).toBe(60);
  style.element.insert(1, { kind: "element", name: name("rPr"), children: [{ kind: "element", name: name("b") }] });
  expect(style.font.bold).toBe(true);
  const volume = Volume.fromJSON({ "/out": "" });
  await model.save({ async write(chunk) { volume.appendFileSync("/out", chunk); } });
  const reopened = await openDocumentStyleModel(new Uint8Array(volume.readFileSync("/out") as Buffer), textContext);
  expect(reopened.styles.at("Coast").element.children.map(child => child.tag.localName)).toEqual(["name", "rPr"]);
});

it("executes the declared XML view operations in validated handle batches", async () => {
  const bytes = await textFixture(paragraph("Coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>` } });
  const result = await applyStyleModelBatch(bytes, { version: 1, operations: [
    { operation: "model.document.Document.styles.get", receiver: ref("document"), arguments: {}, resultHandle: "styles" },
    { operation: "model.styles.styles.Styles.__getitem__.call", receiver: ref("styles"), arguments: { key: "Normal" }, resultHandle: "style" },
    { operation: "model.styles.style.BaseStyle.element.get", receiver: ref("style"), arguments: {}, resultHandle: "xml" },
    { operation: "model.XmlElementView.tag.get", receiver: ref("xml"), arguments: {} },
    { operation: "model.XmlElementView.attributes.get", receiver: ref("xml"), arguments: {} },
    { operation: "model.XmlElementView.children.get", receiver: ref("xml"), arguments: {}, resultHandle: "children" },
    { operation: "model.XmlElementView.text.get", receiver: ref("xml"), arguments: {} },
    { operation: "model.XmlElementView.tail.get", receiver: ref("children", 0), arguments: {} },
    { operation: "model.XmlElementView.set_attribute.call", receiver: ref("xml"), arguments: { name: name("customStyle"), value: "1" } },
    { operation: "model.XmlElementView.text.set", receiver: ref("xml"), arguments: { value: "\n" } },
    { operation: "model.XmlElementView.tail.set", receiver: ref("children", 0), arguments: { value: "\n" } },
    { operation: "model.XmlElementView.insert.call", receiver: ref("xml"), arguments: { index: 1, node: { kind: "element", name: name("aliases") } }, resultHandle: "added" },
    { operation: "model.XmlElementView.remove.call", receiver: ref("added"), arguments: {} },
    { operation: "model.XmlElementView.serialize.call", receiver: ref("xml"), arguments: {} }
  ] }, textContext);
  expect(result.results[3]!.value).toEqual(name("style"));
  expect(result.results[13]!.value).toMatchObject({ kind: "bytes", base64: expect.any(String) });
});

it("shares the admitted work budget and cancellation with retained formatting XML views", async () => {
  const { DocumentBudget } = await import("./index.js");
  const signal = new AbortController(), budget = new DocumentBudget({}, signal.signal);
  const model = await openDocumentStyleModel(undefined, { ...textContext, signal: signal.signal, budget });
  const style = model.styles.add_style("Coast", WD_STYLE_TYPE.PARAGRAPH);
  const font = style.font.element;
  const before = budget.usage.work;
  void font.tag;
  expect(budget.usage.work).toBeGreaterThan(before);
  signal.abort();
  expect(() => font.tag).toThrow();
});

it("keeps collection ownership after structured style and latent insertion/removal", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const initial = model.styles.at("Normal");
  const added = model.styles.element.insert(0, { kind: "element", name: name("style"), attributes: [
    { name: name("type"), value: "character" }, { name: name("styleId"), value: "Shore" }
  ], children: [{ kind: "element", name: name("name"), attributes: [{ name: name("val"), value: "Shore" }] }] });
  const shore = model.styles.at("Shore");
  expect(initial.name).toBe("Normal");
  added.remove();
  expect(() => shore.name).toThrow();
  expect(initial.name).toBe("Normal");
  const latent = model.styles.latent_styles;
  const node = latent.element.insert(0, { kind: "element", name: name("lsdException"), attributes: [{ name: name("name"), value: "Coast" }] });
  const retained = latent.at("Coast");
  expect(retained.name).toBe("Coast");
  node.remove();
  expect(() => retained.name).toThrow();
});

it("maps structured mixed tokens to the parent and faithfully writes root tail whitespace", async () => {
  const model = await openDocumentStyleModel(undefined, textContext);
  const root = model.styles.element;
  expect(root.insert(0, { kind: "comment", text: "Original field notes" })).toBe(root);
  expect(root.insert(0, { kind: "processingInstruction", target: "notes", data: "retained" })).toBe(root);
  expect(root.insert(0, { kind: "text", text: "\n" })).toBe(root);
  root.tail = "\n";
  expect(root.tail).toBe("\n");
  root.tail = null;
  expect(root.tail).toBeNull();
  expect(new TextDecoder().decode(root.serialize())).toContain("Original field notes");
});

it("refuses opaque mutations and validates publication before the sink sees bytes", async () => {
  const { vi } = await import("vitest");
  const bytes = await textFixture(paragraph("Coast"), { styles: { kind: "styles", xml: `<w:styles xmlns:w="${w}" xmlns:q="urn:retained"><w:style w:type="character" w:styleId="Coast" q:flag="keep"><w:name w:val="Coast"/><q:data>retained</q:data></w:style></w:styles>` } });
  const model = await openDocumentStyleModel(bytes, textContext);
  const style = model.styles.at("Coast");
  expect(() => style.element.children[1]!.text = "changed").toThrow();
  expect(() => style.element.set_attribute({ namespaceURI: "urn:retained", localName: "flag" }, "changed")).toThrow();
  style.element.set_attribute(name("type"), "invalid-kind");
  const sink = { write: vi.fn() };
  await expect(model.save(sink)).rejects.toThrow();
  expect(sink.write).not.toHaveBeenCalled();
});

it("rejects injected attribute syntax as a name before structured mutation", async () => {
  const { validateDocxValue } = await import("./index.js");
  const model = await openDocumentStyleModel(undefined, textContext);
  const style = model.styles.add_style("Coast", WD_STYLE_TYPE.CHARACTER);
  const injected = { namespaceURI: w, localName: 'safe="injected" other' };
  expect(validateDocxValue("ExpandedName", injected)).toBe(false);
  expect(() => style.element.set_attribute(injected, "value")).toThrow();
  expect([...style.element.attributes].some(([name]) => name.localName === "safe")).toBe(false);
});

it("uses one cumulative default budget for a standalone formatting owner", async () => {
  const { vi } = await import("vitest");
  const { Font, DocumentBudget } = await import("./index.js");
  const charge = vi.spyOn(DocumentBudget.prototype, "charge");
  try {
    let source = `<w:r xmlns:w="${w}"><w:rPr/></w:r>`;
    const owner = { getXml: () => source, setXml: (xml: string) => { source = xml; } };
    const font = new Font(owner);
    void font.element.tag;
    void font.element.children;
    void font.bold;
    expect(new Set(charge.mock.contexts).size).toBe(1);
  } finally { charge.mockRestore(); }
});
