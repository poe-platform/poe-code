import { expect, it } from "vitest";
import { Document, UnsupportedEditError } from "./index.js";
import { textContext, textFixture, w, r } from "../tests/fixtures/text.js";

it.each(["preceding_paragraph_fragment", "following_paragraph_fragment"] as const)(
  "refuses %s on a later cached marker without changing the source",
  async property => {
    const markers = '<w:lastRenderedPageBreak/><w:lastRenderedPageBreak/>';
    const content = property === "preceding_paragraph_fragment" ? `<w:t>North</w:t>${markers}` : `${markers}<w:t>North</w:t>`;
    const document = await Document(await textFixture(`<w:p><w:r>${content}</w:r></w:p>`), textContext);
    const paragraph = document.paragraphs[0]!;
    const before = paragraph.element.serialize();
    expect(() => paragraph.rendered_page_breaks[1]![property]).toThrow(UnsupportedEditError);
    expect(paragraph.element.serialize()).toEqual(before);
  }
);

it.each([
  { property: "preceding_paragraph_fragment", content: '<w:lastRenderedPageBreak/><w:t>North</w:t><w:t>Bay</w:t>' },
  { property: "following_paragraph_fragment", content: '<w:t>North</w:t><w:t>Bay</w:t><w:lastRenderedPageBreak/>' }
] as const)("returns null for a boundary-only $property", async ({ property, content }) => {
  const document = await Document(await textFixture(`<w:p><w:pPr><w:ind/></w:pPr><w:r>${content}</w:r></w:p>`), textContext);
  const paragraph = document.paragraphs[0]!;
  const before = paragraph.element.serialize();
  expect(paragraph.rendered_page_breaks[0]![property]).toBeNull();
  expect(paragraph.element.serialize()).toEqual(before);
});

it.each([
  { property: "preceding_paragraph_fragment", hyperlink: false },
  { property: "following_paragraph_fragment", hyperlink: false },
  { property: "preceding_paragraph_fragment", hyperlink: true },
  { property: "following_paragraph_fragment", hyperlink: true }
] as const)("extracts exact $property XML with hyperlink=$hyperlink", async ({ property, hyperlink }) => {
  const content = '<w:r><w:t>North</w:t><w:lastRenderedPageBreak/><w:t>Bay</w:t></w:r>';
  const preceding = property === "preceding_paragraph_fragment";
  const tail = `<w:r><w:t>Depth</w:t></w:r>${hyperlink && !preceding ? '<w:r><w:t>Note</w:t></w:r>' : ""}`;
  const document = await Document(await textFixture(`<w:p><w:pPr><w:ind/></w:pPr>${hyperlink ? `<w:hyperlink>${content}</w:hyperlink>` : content}${tail}</w:p>`), textContext);
  const paragraph = document.paragraphs[0]!;
  const before = paragraph.element.serialize();
  const fragment = paragraph.rendered_page_breaks[0]![property]!;
  const splitRun = `<w:r xmlns:w="${w}" xmlns:r="${r}">${hyperlink ? '<w:t>North</w:t><w:t>Bay</w:t>' : preceding ? '<w:t>North</w:t>' : '<w:t>Bay</w:t>'}</w:r>`;
  const expected = preceding
    ? hyperlink ? `<w:hyperlink xmlns:w="${w}" xmlns:r="${r}">${splitRun}</w:hyperlink>` : splitRun
    : `${hyperlink ? "" : splitRun}${tail}`;
  expect(new TextDecoder().decode(fragment.element.serialize())).toBe(`<w:p xmlns:bm="${w}" xmlns:w="${w}" xmlns:r="${r}"><w:pPr><w:ind/></w:pPr>${expected}</w:p>`);
  fragment.text = "Detached edit";
  expect(paragraph.element.serialize()).toEqual(before);
});
