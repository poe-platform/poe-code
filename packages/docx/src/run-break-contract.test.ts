import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, InputTypeError, WD_BREAK, WD_ORIENTATION, getDocumentXml } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

const breaks = [
  [WD_BREAK.LINE, "", "\n"],
  [WD_BREAK.PAGE, ' bm:type="page"', ""],
  [WD_BREAK.COLUMN, ' bm:type="column"', ""],
  [WD_BREAK.LINE_CLEAR_LEFT, ' bm:clear="left"', "\n"],
  [WD_BREAK.LINE_CLEAR_RIGHT, ' bm:clear="right"', "\n"],
  [WD_BREAK.LINE_CLEAR_ALL, ' bm:clear="all"', "\n"],
  [WD_BREAK.TEXT_WRAPPING, ' bm:clear="all"', "\n"]
] as const;

it.each(breaks)(
  "writes exact break markup for %s and retains the run owner",
  async (kind, attributes, text) => {
    const document = await Document(
      await textFixture('<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>潮 🌿</w:t></w:r></w:p>'),
      textContext
    );
    const owner = document.paragraphs[0]!.runs[0]!;
    owner.add_break(kind);
    expect(new TextDecoder().decode(owner.element.serialize())).toContain(
      `<bm:br xmlns:bm="${w}"${attributes}/>`
    );
    expect(owner.text).toBe(`潮 🌿${text}`);
    expect(owner.bold).toBe(false);
    expect(owner.equals(document.paragraphs[0]!.runs[0])).toBe(true);
    const fs = Volume.fromJSON({ "/out": "" });
    await document.save({
      async write(bytes) {
        fs.appendFileSync("/out", bytes);
      }
    });
    const bytes = new Uint8Array(fs.readFileSync("/out") as Uint8Array);
    expect(
      new TextDecoder().decode(
        (await getDocumentXml(bytes, textContext, {
          part: "/word/document.xml",
          raw: true
        })) as Uint8Array
      )
    ).toContain(`<bm:br xmlns:bm="${w}"${attributes}/>`);
  }
);

it("uses an attribute-free line break by default", async () => {
  const document = await Document(undefined, textContext);
  const owner = document.add_paragraph().add_run();
  owner.add_break();
  expect(new TextDecoder().decode(owner.element.serialize())).toContain(`<bm:br xmlns:bm="${w}"/>`);
  expect(owner.text).toBe("\n");
});

it.each([
  WD_BREAK.SECTION_CONTINUOUS,
  WD_BREAK.SECTION_EVEN_PAGE,
  WD_BREAK.SECTION_NEXT_PAGE,
  WD_BREAK.SECTION_ODD_PAGE,
  WD_ORIENTATION.PORTRAIT,
  null,
  6,
  { enum: "WD_BREAK_TYPE", name: "LINE", value: 6 },
  { enum: "WD_BREAK_TYPE", name: "MISSING", value: 6 }
])("rejects unsupported or untrusted break values %s without changing content", async (value) => {
  const document = await Document(undefined, textContext);
  const owner = document.add_paragraph("Signal").runs[0]!;
  const before = owner.element.serialize();
  expect(() => owner.add_break(value as typeof WD_BREAK.LINE)).toThrow(InputTypeError);
  expect(owner.element.serialize()).toEqual(before);
});

it("uses the declared batch enum value to write a clearing break through the SDK", async () => {
  const { applyStyleModelBatch } = await import("./style-model-batch.js");
  const input = await textFixture("<w:p><w:r><w:t>Signal</w:t></w:r></w:p>");
  const batch = await applyStyleModelBatch(
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
          operation: "model.text.paragraph.Paragraph.runs.get",
          receiver: { resultHandle: "paragraphs", index: 0 },
          arguments: {},
          resultHandle: "runs"
        },
        {
          operation: "model.text.run.Run.add_break.call",
          receiver: { resultHandle: "runs", index: 0 },
          arguments: { breakType: { enum: "WD_BREAK_TYPE", name: "LINE_CLEAR_LEFT" } }
        }
      ]
    },
    textContext
  );
  const fs = Volume.fromJSON({ "/out": "" });
  await batch.save({
    async write(bytes) {
      fs.appendFileSync("/out", bytes);
    }
  });
  const document = await Document(
    new Uint8Array(fs.readFileSync("/out") as Uint8Array),
    textContext
  );
  expect(document.paragraphs[0]!.text).toBe("Signal\n");
  expect(new TextDecoder().decode(document.paragraphs[0]!.runs[0]!.element.serialize())).toContain(
    `<bm:br xmlns:bm="${w}" bm:clear="left"/>`
  );
});
