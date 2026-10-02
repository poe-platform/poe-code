import { expect, it } from "vitest";
import { Document, Emu, WD_INLINE_SHAPE, parseDocumentXml } from "./index.js";
import { paragraph, textFixture, w } from "../tests/fixtures/text.js";
const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const alternate = (selected: string, inactive: string) =>
  `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:req="${w}" Requires="req">${selected}</mc:Choice><mc:Fallback>${inactive}</mc:Fallback></mc:AlternateContent>`;
const drawing = (uri: string, payload = "") =>
  `<w:r><w:drawing><wp:inline xmlns:wp="${wp}"><wp:extent cx="12700" cy="25400"/><a:graphic xmlns:a="${a}"><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

it("counts only active inline drawing alternatives", async () => {
  const document = await Document(
    await textFixture(`<w:p>${alternate(drawing("urn:selected"), drawing("urn:inactive"))}</w:p>`)
  );
  expect(document.inline_shapes).toHaveLength(1);
  expect([...document.inline_shapes]).toHaveLength(1);
  expect(document.inline_shapes.at(0).width.emu).toBe(12700);
});

it("reads selected shape extents and preserves guarded alternative content on rejected writes", async () => {
  const markup = drawing(
    pic,
    `<a:xfrm xmlns:a="${a}">${alternate('<a:ext cx="12700" cy="25400"/>', '<a:ext cx="999" cy="999"/>')}</a:xfrm>`
  ).replace(
    '<wp:extent cx="12700" cy="25400"/>',
    alternate('<wp:extent cx="12700" cy="25400"/>', '<wp:extent cx="999" cy="999"/>')
  );
  const document = await Document(await textFixture(`<w:p>${markup}</w:p>`));
  const shape = document.inline_shapes.at(0);
  expect(shape.width.emu).toBe(12700);
  const before = shape.element.serialize();
  expect(() => {
    shape.width = Emu(38100);
  }).toThrow("faithful preservation");
  expect(shape.width.emu).toBe(12700);
  expect(shape.element.serialize()).toEqual(before);
  expect(new TextDecoder().decode(shape.element.serialize())).toContain('cx="999"');
  expect(document.inline_shapes.part).toBe(document.part);
});

it("rejects empty lexical inline extents", async () => {
  const document = await Document(
    await textFixture(`<w:p>${drawing(pic).replace('cx="12700"', 'cx=""')}</w:p>`)
  );
  expect(() => document.inline_shapes.at(0).width).toThrow("Invalid inline shape extent");
});

it("uses graphic data URI rather than arbitrary descendant tags for shape type", async () => {
  for (const [uri, payload, expected] of [
    ["http://schemas.openxmlformats.org/drawingml/2006/chart", "", WD_INLINE_SHAPE.CHART],
    ["urn:unrecognized-data", `<pic:pic xmlns:pic="${pic}"/>`, WD_INLINE_SHAPE.NOT_IMPLEMENTED]
  ] as const) {
    const document = await Document(await textFixture(`<w:p>${drawing(uri, payload)}</w:p>`));
    expect(document.inline_shapes.at(0).type).toBe(expected);
  }
});

it("reads selected page header policy and excludes inactive alternatives", async () => {
  const document = await Document(
    await textFixture(paragraph("Body"), {
      settings: {
        kind: "settings",
        xml: `<w:settings xmlns:w="${w}">${alternate("<w:evenAndOddHeaders/>", '<w:evenAndOddHeaders w:val="0"/>')}</w:settings>`
      }
    })
  );
  expect(document.settings.odd_and_even_pages_header_footer).toBe(true);
});

it("inserts the page header policy before later settings properties", async () => {
  const document = await Document(
    await textFixture(paragraph("Body"), {
      settings: { kind: "settings", xml: `<w:settings xmlns:w="${w}"><w:compat/></w:settings>` }
    })
  );
  document.settings.odd_and_even_pages_header_footer = true;
  const root = parseDocumentXml(document.settings.element.serialize()).root;
  expect(root.children.map((node) => node.localName)).toEqual(["evenAndOddHeaders", "compat"]);
});
