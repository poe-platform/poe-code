import { expect, it } from "vitest";
import { Volume } from "memfs";
import {
  Document,
  InputTypeError,
  InvalidValueError,
  WD_ORIENT,
  WD_SECTION_START
} from "./index.js";
import { applyStyleModelBatch } from "./style-model-batch.js";
import { textContext } from "../tests/fixtures/text.js";

it("adds title and heading levels with original styles and exact text", async () => {
  const document = await Document();
  for (const level of [0, 1, 2, 5, 9]) {
    const heading = document.add_heading(`Survey ${level} 🌊`, level);
    expect(heading.text).toBe(`Survey ${level} 🌊`);
    expect(heading.style?.name).toBe(level === 0 ? "Title" : `Heading ${level}`);
  }
  expect(document.add_heading("Default").style?.name).toBe("Heading 1");
  const before = document.store.snapshot();
  for (const level of [-1, 10])
    expect(() => document.add_heading("", level)).toThrow(InvalidValueError);
  for (const level of [0.5, "1" as unknown as number])
    expect(() => document.add_heading("", level)).toThrow(InputTypeError);
  expect(document.store.snapshot()).toEqual(before);
});

it("adds a page break paragraph without treating it as cached rendered pagination", async () => {
  const document = await Document();
  document.add_paragraph("Start");
  const inserted = document.add_page_break();
  expect(document.paragraphs.at(-1)).toBe(inserted);
  expect(inserted.text).toBe("");
  expect(inserted.contains_page_break).toBe(false);
  const xml = new TextDecoder().decode(inserted.element.serialize());
  expect(xml).toContain('type="page"');
  expect(inserted.runs).toHaveLength(1);
});

it("adds sections with retained old headers and linked new variants", async () => {
  const document = await Document();
  const first = document.sections.at(0);
  first.header.paragraphs[0]!.text = "Coast header";
  first.footer.paragraphs[0]!.text = "Coast footer";
  document.add_paragraph("Body");
  const added = document.add_section(WD_SECTION_START.EVEN_PAGE);
  added.orientation = WD_ORIENT.LANDSCAPE;
  expect(document.sections).toHaveLength(2);
  expect(document.sections.at(0).orientation).toBe(WD_ORIENT.PORTRAIT);
  expect(added.orientation).toBe(WD_ORIENT.LANDSCAPE);
  expect(added.start_type).toBe(WD_SECTION_START.EVEN_PAGE);
  for (const story of [
    added.header,
    added.even_page_header,
    added.first_page_header,
    added.footer,
    added.even_page_footer,
    added.first_page_footer
  ])
    expect(story.is_linked_to_previous).toBe(true);
  expect(added.header.paragraphs[0]?.text).toBe("Coast header");
  expect(added.footer.paragraphs[0]?.text).toBe("Coast footer");
  const volume = Volume.fromJSON({ "/document": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/document", bytes);
    }
  });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/document") as Buffer));
  expect(reopened.sections).toHaveLength(2);
  expect(reopened.sections.at(0).header.paragraphs[0]?.text).toBe("Coast header");
  expect(reopened.sections.at(1).header.is_linked_to_previous).toBe(true);
});

it("runs document creation workflows through closed SDK batch operations", async () => {
  const document = await Document();
  const volume = Volume.fromJSON({ "/input": "" });
  await document.save({
    async write(bytes) {
      volume.appendFileSync("/input", bytes);
    }
  });
  const receiver = { id: "document", type: "DocumentModel", owner: "document", revision: 0 };
  const result = await applyStyleModelBatch(
    new Uint8Array(volume.readFileSync("/input") as Buffer),
    {
      version: 1,
      operations: [
        {
          operation: "model.document.Document.add_heading.call",
          receiver,
          arguments: { text: "Coast", level: 0 },
          resultHandle: "heading"
        },
        {
          operation: "model.text.paragraph.Paragraph.text.get",
          receiver: { resultHandle: "heading" },
          arguments: {}
        },
        { operation: "model.document.Document.add_page_break.call", receiver, arguments: {} },
        { operation: "model.document.Document.add_section.call", receiver, arguments: {} }
      ]
    },
    textContext
  );
  expect(result.results[1]?.value).toBe("Coast");
  expect(result.affected).toBe(3);
});
