import { Volume } from "memfs";
import { expect, it } from "vitest";
import { Paragraph } from "./text-paragraphs.js";
import { parseXmlPart } from "./xml.js";

const namespace = "http://schemas.openxmlformats.org/drawingml/2006/main";
const limits = { maxBytes: 8192, maxNodes: 100, maxDepth: 16 };
function paragraph(language?: string): Paragraph {
  return new Paragraph(
    parseXmlPart(
      new TextEncoder().encode(
        `<a:p xmlns:a="${namespace}"><a:r><a:rPr b="0"${language === undefined ? "" : ` lang="${language}"`}/><a:t>Coastal survey</a:t></a:r></a:p>`
      ),
      limits
    )
  );
}

it.each([
  [undefined, 0],
  ["pl-PL", 1045],
  ["de-AT", 3079],
  ["fr-FR", 1036]
] as const)("reads the language symbol for %s without creating XML", (language, expected) => {
  const model = paragraph(language);
  const font = model.runs[0]!.font;
  const before = model.xml.bytes();
  expect(font.language_id).toBe(expected);
  expect(model.xml.bytes()).toEqual(before);
});

it("persists language assignment through the existing live font into memory XML", () => {
  const model = paragraph();
  const font = model.runs[0]!.font;
  font.language_id = 1045;
  expect(model.xml.markup(model.xml.root)).toContain('lang="pl-PL"');
  expect(font.bold).toBe(false);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/paragraph.xml", model.xml.bytes());
  const reopened = new Paragraph(
    parseXmlPart(new Uint8Array(volume.readFileSync("/paragraph.xml") as Buffer), limits)
  );
  expect(reopened.runs[0]!.font.language_id).toBe(1045);
  expect(reopened.text).toBe("Coastal survey");
});

it.each([null, 0])("removes a language override for %s while preserving false", (value) => {
  const model = paragraph("fr-FR");
  const font = model.runs[0]!.font;
  font.language_id = value;
  expect(font.language_id).toBe(0);
  expect(model.xml.markup(model.xml.root)).not.toContain("lang=");
  expect(font.bold).toBe(false);
});

it.each([false, "pl-PL", 1.5, NaN, Infinity, 999999])(
  "rejects invalid language %s before changing XML",
  (value) => {
    const model = paragraph("fr-FR");
    const font = model.runs[0]!.font;
    const before = model.xml.bytes();
    expect(() => {
      font.language_id = value as number;
    }).toThrow();
    expect(model.xml.bytes()).toEqual(before);
  }
);

it("rejects unknown stored language values without changing the imported content", () => {
  const model = paragraph("x-original-language");
  const before = model.xml.bytes();
  expect(() => model.runs[0]!.font.language_id).toThrow();
  expect(model.xml.bytes()).toEqual(before);
});

it("invalidates language access with its removed run", () => {
  const model = paragraph("pl-PL");
  const font = model.runs[0]!.font;
  model.clear();
  expect(() => font.language_id).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
  expect(() => {
    font.language_id = 1036;
  }).toThrowError(expect.objectContaining({ code: "invalid-handle" }));
});
