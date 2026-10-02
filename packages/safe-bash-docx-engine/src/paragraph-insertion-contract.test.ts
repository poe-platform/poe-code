import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, InputTypeError, WD_STYLE_TYPE, applyStyleModelBatch } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";

it.each(["name", "owner"])("resolves an inserted paragraph style by %s", async (kind) => {
  const document = await Document(
    await textFixture("<w:p><w:r><w:t>Retained</w:t></w:r></w:p>"),
    textContext
  );
  const style = document.styles.add_style("Coastal detail", WD_STYLE_TYPE.PARAGRAPH);
  style.style_id = "detail-42";
  const retained = document.paragraphs[0]!;
  const inserted = retained.insert_paragraph_before(
    "潮 🌿\tLine\nEnd",
    kind === "name" ? style.name! : style
  );
  expect(inserted.style!.equals(style)).toBe(true);
  expect(new TextDecoder().decode(inserted.element.serialize())).toContain(
    `<bm:pStyle bm:val="detail-42"/>`
  );
  expect(inserted.text).toBe("潮 🌿\tLine\nEnd");
  expect(document.paragraphs.map((p) => p.text)).toEqual([inserted.text, "Retained"]);
  expect(retained.equals(document.paragraphs[1])).toBe(true);
  const fs = Volume.fromJSON({ "/out": "" });
  await document.save({
    async write(bytes) {
      fs.appendFileSync("/out", bytes);
    }
  });
  const reopened = await Document(
    new Uint8Array(fs.readFileSync("/out") as Uint8Array),
    textContext
  );
  expect(reopened.paragraphs[0]!.style!.style_id).toBe("detail-42");
  expect(reopened.paragraphs[0]!.text).toBe(inserted.text);
});

it.each([undefined, null, ""])("inserts no fabricated run for empty text %s", async (text) => {
  const document = await Document(await textFixture("<w:p/>"), textContext);
  const inserted = document.paragraphs[0]!.insert_paragraph_before(text);
  expect(inserted.runs).toHaveLength(0);
  expect(new TextDecoder().decode(inserted.element.serialize())).toBe(
    `<bm:p xmlns:w="${w}" xmlns:r="${r}" xmlns:bm="${w}"></bm:p>`
  );
});

it.each([
  [null, null],
  ["Survey", null],
  [null, "Coastal detail"],
  ["Survey", "Coastal detail"]
] as const)("retains exact paragraph order for text %s and style %s", async (text, name) => {
  const document = await Document(await textFixture('<w:p id="42"/>'), textContext);
  const style = document.styles.add_style("Coastal detail", WD_STYLE_TYPE.PARAGRAPH);
  style.style_id = "detail-42";
  const retained = document.paragraphs[0]!;
  const inserted = retained.insert_paragraph_before(text, name);
  expect(inserted.runs).toHaveLength(text === null ? 0 : 1);
  expect(inserted.style!.name).toBe(name ?? "Normal");
  const props = name === null ? "" : '<bm:pPr><bm:pStyle bm:val="detail-42"/></bm:pPr>';
  const content =
    text === null ? "" : `<pi:r xmlns:pi="${w}"><pi:t xml:space="preserve">Survey</pi:t></pi:r>`;
  expect(new TextDecoder().decode(document.element.serialize())).toContain(
    `<w:body><bm:p xmlns:bm="${w}">${props}${content}</bm:p><w:p id="42"/></w:body>`
  );
  expect(retained.equals(document.paragraphs[1])).toBe(true);
});

it("inserts through the declared typed batch with the same style lookup", async () => {
  const input = await textFixture("<w:p><w:r><w:t>Retained</w:t></w:r></w:p>", {
    styles: {
      kind: "styles",
      xml: `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="detail-42"><w:name w:val="Coastal detail"/></w:style></w:styles>`
    }
  });
  const result = await applyStyleModelBatch(
    input,
    {
      version: 1,
      operations: [
        {
          operation: "model.document.Document.paragraphs.get",
          receiver: { resultHandle: "document" },
          arguments: {},
          resultHandle: "paragraphs"
        },
        {
          operation: "model.text.paragraph.Paragraph.insert_paragraph_before.call",
          receiver: { resultHandle: "paragraphs", index: 0 },
          arguments: { text: "潮 🌿", style: "Coastal detail" },
          resultHandle: "inserted"
        }
      ]
    },
    textContext
  );
  const fs = Volume.fromJSON({ "/out": "" });
  await result.save({
    async write(bytes) {
      fs.appendFileSync("/out", bytes);
    }
  });
  const document = await Document(
    new Uint8Array(fs.readFileSync("/out") as Uint8Array),
    textContext
  );
  expect(document.paragraphs.map((p) => p.text)).toEqual(["潮 🌿", "Retained"]);
  expect(document.paragraphs[0]!.style!.style_id).toBe("detail-42");
  expect(new TextDecoder().decode(document.paragraphs[0]!.element.serialize())).toContain(
    '<bm:pStyle bm:val="detail-42"/>'
  );
});

it.each(["missing", "character", "foreign", "text"])(
  "rejects %s before paragraph insertion",
  async (kind) => {
    const document = await Document(await textFixture("<w:p/>"), textContext);
    const retained = document.paragraphs[0]!;
    const style =
      kind === "foreign"
        ? (await Document(undefined, textContext)).styles.add_style(
            "Foreign detail",
            WD_STYLE_TYPE.PARAGRAPH
          )
        : kind === "character"
          ? document.styles.add_style("Inline detail", WD_STYLE_TYPE.CHARACTER)
          : "Missing detail";
    const before = document.element.serialize();
    const parts = document.part.package.parts.map((part) => [part.partname, part.blob]);
    const action = () =>
      retained.insert_paragraph_before(
        kind === "text" ? (42 as never) : "New",
        kind === "text" ? undefined : (style as never)
      );
    if (kind === "text") expect(action).toThrow(InputTypeError);
    else expect(action).toThrow();
    expect(document.element.serialize()).toEqual(before);
    expect(document.part.package.parts.map((part) => [part.partname, part.blob])).toEqual(parts);
    expect(retained.equals(document.paragraphs[0])).toBe(true);
  }
);
