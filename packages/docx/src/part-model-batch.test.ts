import { expect, it } from "vitest";
import { applyStyleModelBatch, WD_STYLE_TYPE, Document } from "./index.js";
import { packageViewBatchActions } from "./package-view-batch-operations.js";
import { paragraph, textFixture, textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";

it("keeps named part receivers distinct and exposes their original factories", async () => {
  const document = await Document(undefined, textContext);
  const headerAction = packageViewBatchActions.get("model.parts.hdrftr.HeaderPart.next_id.get")!;
  expect(() => headerAction(document.part, {})).toThrow();
  const create = packageViewBatchActions.get("model.parts.hdrftr.HeaderPart.new.call");
  expect(create).toBeTypeOf("function");
  const header = await create!(undefined, { ownerPackage: document.part.package });
  expect(headerAction(header, {})).toBe(1);
  const blob = packageViewBatchActions.get("model.parts.hdrftr.HeaderPart.blob.get");
  expect(blob).toBeTypeOf("function");
  expect(blob!(header, {})).toBeInstanceOf(Uint8Array);
  expect(packageViewBatchActions.get("model.parts.hdrftr.HeaderPart.load.call")).toBeTypeOf("function");
  const add = packageViewBatchActions.get("model.parts.document.DocumentPart.add_header_part.call")!;
  const [bound, id] = add(document.part, {}) as readonly [import("./package-view.js").HeaderPart, string];
  const drop = packageViewBatchActions.get("model.parts.document.DocumentPart.drop_header_part.call");
  expect(drop).toBeTypeOf("function");
  drop!(document.part, { rId: id });
  expect(() => bound.blob).toThrow();
});

it("retains specialized returned part types in serialized batch handles", async () => {
  const bytes = await textFixture(paragraph("Current survey"));
  const result = await applyStyleModelBatch(bytes, { version: 1, operations: [
    { operation: "model.document.Document.part.get", receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 }, arguments: {}, resultHandle: "part" },
    { operation: "model.parts.document.DocumentPart.package.get", receiver: { resultHandle: "part" }, arguments: {}, resultHandle: "package" },
    { operation: "model.parts.settings.SettingsPart.default.call", arguments: { ownerPackage: { resultHandle: "package" } }, resultHandle: "settingsPart" },
    { operation: "model.parts.settings.SettingsPart.settings.get", receiver: { resultHandle: "settingsPart" }, arguments: {} }
  ] }, textContext);
  expect(result.results[2]!.value).toMatchObject({ type: "SettingsPart" });
  expect(result.results[3]!.value).toMatchObject({ type: "Settings" });
});

it("maps document equality protocols to the live document owner", async () => {
  const receiver = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
  const result = await applyStyleModelBatch(await textFixture(paragraph("Owner")), { version: 1, operations: [
    { operation: "model.document.Document.__eq__.call", receiver, arguments: { other: receiver } },
    { operation: "model.document.Document.__ne__.call", receiver, arguments: { other: null } }
  ] }, textContext);
  expect(result.results.map(result => result.value)).toEqual([true, true]);
});

it("admits a story image through a closed batch action without inserting content", async () => {
  const document = await Document(undefined, textContext);
  const action = packageViewBatchActions.get("model.parts.document.DocumentPart.new_pic_inline.call");
  expect(action).toBeTypeOf("function");
  const inline = await action!(document.part, { imageDescriptor: rasterPng(8, 4), width: { value: 800, unit: "emu" } }, textContext) as import("./xml-element-view.js").XmlElementView;
  expect(inline.localName).toBe("inline");
  const extent = inline.children.find(node => node.localName === "extent")!;
  expect([...extent.attributes].find(([name]) => name.localName === "cx")![1]).toBe("800");
  expect([...extent.attributes].find(([name]) => name.localName === "cy")![1]).toBe("400");
  expect(document.inline_shapes.length).toBe(0);
});

it("exposes returned document parts through validated typed batch operations", async () => {
  const bytes = await textFixture(paragraph("Current survey"));
  const result = await applyStyleModelBatch(bytes, { version: 1, operations: [
    { operation: "model.document.Document.part.get", receiver: { id: "document", type: "DocumentModel", owner: "document", revision: 0 }, resultHandle: "part", arguments: {} },
    { operation: "model.parts.document.DocumentPart.document.get", receiver: { resultHandle: "part" }, arguments: {} },
    { operation: "model.parts.document.DocumentPart.styles.get", receiver: { resultHandle: "part" }, arguments: {} },
    { operation: "model.parts.document.DocumentPart.next_id.get", receiver: { resultHandle: "part" }, arguments: {} }
  ] }, textContext);
  expect(result.results[1]!.value).toMatchObject({ type: "DocumentModel" });
  expect(result.results[2]!.value).toMatchObject({ type: "Styles" });
  expect(result.results[3]!.value).toBe(1);
  expect(result.affected).toBe(1);
});

it("rejects forged story receivers and preserves owned style lookup", async () => {
  const doc = await Document(undefined, textContext);
  const get = packageViewBatchActions.get("model.parts.document.DocumentPart.get_style.call");
  expect(get).toBeTypeOf("function");
  expect(() => get!({}, { styleId: null, styleType: WD_STYLE_TYPE.PARAGRAPH })).toThrow();
  const style = get!(doc.part, { styleId: null, styleType: WD_STYLE_TYPE.PARAGRAPH }) as ReturnType<typeof doc.styles.default>;
  expect(style!.equals(doc.styles.default(WD_STYLE_TYPE.PARAGRAPH))).toBe(true);
});
