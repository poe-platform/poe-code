import { expect, it } from "vitest";
import { openDocumentStyleModel } from "./styles-model.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { packageViewBatchActions } from "./package-view-batch-operations.js";
import {
  DocumentPartView,
  NumberingPart,
  _NumberingDefinitions,
  XmlPartView
} from "./package-view.js";

async function existing(count: number, abstractCount = 2) {
  const xml = `<w:numbering xmlns:w="${w}">${Array.from({ length: abstractCount }, (_, i) => `<w:abstractNum w:abstractNumId="${i}"/>`).join("")}${Array.from({ length: count }, (_, i) => `<w:num w:numId="${i}"><w:abstractNumId w:val="0"/></w:num>`).join("")}</w:numbering>`;
  return openDocumentStyleModel(
    await textFixture("<w:p/>", { numbering: { kind: "numbering", xml } }),
    textContext
  );
}

it.each([0, 1, 10])(
  "counts concrete numbering definitions independently of abstract entries %i",
  async (count) => {
    const model = await existing(count);
    const main: DocumentPartView = model.package.main_document_part;
    const numbering: NumberingPart = main.numbering_part;
    expect(numbering).toBeInstanceOf(XmlPartView);
    expect(numbering.numbering_definitions.length).toBe(count);
    expect(numbering.numbering_definitions).toBe(numbering.numbering_definitions);
    expect(
      main.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering"
      )
    ).toBe(numbering);
    expect(numbering.part).toBe(numbering);
    expect(numbering.package).toBe(main.package);
    expect(numbering.element.localName).toBe("numbering");
    expect(numbering.content_type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"
    );
    expect(numbering.partname.toString()).toBe("/word/numbering.xml");
    const before = numbering.blob,
      copy = numbering.blob;
    copy.fill(0);
    expect(numbering.blob).toEqual(before);
  }
);
it("keeps the concrete-definition collection live across bounded XML edits", async () => {
  const model = await existing(1);
  const part: NumberingPart = model.package.main_document_part.numbering_part;
  const definitions: _NumberingDefinitions = part.numbering_definitions;
  part.element.insert(part.element.children.length, {
    kind: "element",
    name: { namespaceURI: w, localName: "num" },
    attributes: [{ name: { namespaceURI: w, localName: "numId" }, value: "7" }],
    children: [
      {
        kind: "element",
        name: { namespaceURI: w, localName: "abstractNumId" },
        attributes: [{ name: { namespaceURI: w, localName: "val" }, value: "0" }],
        children: []
      }
    ]
  });
  expect(definitions.length).toBe(2);
  part.element.children.find((n) => n.localName === "num")!.remove();
  expect(definitions.length).toBe(1);
});
it("rejects unavailable numbering creation without mutating the owner package", async () => {
  const model = await openDocumentStyleModel(await textFixture("<w:p/>"), textContext);
  const main: DocumentPartView = model.package.main_document_part;
  const before = model.package.parts.map((p) => [p.partname.toString(), p.blob]);
  expect(() => main.numbering_part).toThrow();
  expect(model.package.parts.map((p) => [p.partname.toString(), p.blob])).toEqual(before);
});
it("rejects ambiguous internal numbering ownership without choosing a target", async () => {
  const model = await existing(1);
  const main: DocumentPartView = model.package.main_document_part;
  main.load_rel(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering",
    main.numbering_part,
    "otherNumbering"
  );
  expect(() => main.numbering_part).toThrow();
});

it("exposes explicit unsupported creation and rejects an incompatible typed load", async () => {
  const model = await openDocumentStyleModel(await textFixture("<w:p/>"), textContext);
  expect(() => NumberingPart.new()).toThrow();
  await expect(
    NumberingPart.load(
      "/word/numbering.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
      new TextEncoder().encode(`<w:styles xmlns:w="${w}"/>`),
      model.package
    )
  ).rejects.toThrow();
  expect(model.package.parts.some((p) => p.partname.toString() === "/word/numbering.xml")).toBe(
    false
  );
});

it("routes existing numbering reads through declared typed package batch actions", async () => {
  const model = await existing(10);
  const part = packageViewBatchActions.get("model.parts.document.DocumentPart.numbering_part.get")!(
    model.package.main_document_part,
    {}
  );
  const definitions = packageViewBatchActions.get(
    "model.parts.numbering.NumberingPart.numbering_definitions.get"
  )!(part, {});
  expect(
    packageViewBatchActions.get("model.parts.numbering._NumberingDefinitions.__len__.get")!(
      definitions,
      {}
    )
  ).toBe(10);
  expect(
    packageViewBatchActions.get("model.parts.numbering.NumberingPart.part.get")!(part, {})
  ).toBe(part);
  expect(() =>
    packageViewBatchActions.get("model.parts.numbering.NumberingPart.new.call")!(null, {})
  ).toThrow();
});
