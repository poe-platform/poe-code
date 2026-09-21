import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document } from "./index.js";
import { paragraph, textContext, textFixture, w, r } from "../tests/fixtures/text.js";

it.each([
  { key: "header", kind: "header", variant: "default" },
  { key: "first_page_header", kind: "header", variant: "first" },
  { key: "even_page_header", kind: "header", variant: "even" },
  { key: "footer", kind: "footer", variant: "default" },
  { key: "first_page_footer", kind: "footer", variant: "first" },
  { key: "even_page_footer", kind: "footer", variant: "even" }
] as const)("retains a shared $key relationship until its final explicit binding is removed", async ({ key, kind, variant }) => {
  const reference = `<w:${kind}Reference w:type="${variant}" r:id="story"/>`;
  const input = await textFixture(`<w:p><w:pPr><w:sectPr>${reference}</w:sectPr></w:pPr></w:p><w:sectPr>${reference}</w:sectPr>`, {
    story: { kind, xml: `<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}">${paragraph("海岸 🌊")}</w:${kind === "header" ? "hdr" : "ftr"}>` }
  });
  const volume = Volume.fromJSON({ "/input": Buffer.from(input), "/saved": "" });
  const document = await Document(new Uint8Array(volume.readFileSync("/input") as Buffer), textContext);
  const first = document.sections[0]![key], last = document.sections[1]![key];
  const retained = last.paragraphs[0]!;
  expect(first.is_linked_to_previous).toBe(false);
  expect(last.is_linked_to_previous).toBe(false);
  first.is_linked_to_previous = true;
  expect(new TextDecoder().decode(document.part.blob)).toBe(`<w:document xmlns:w="${w}" xmlns:r="${r}"><w:body><w:p><w:pPr><w:sectPr></w:sectPr></w:pPr></w:p><w:sectPr>${reference}</w:sectPr></w:body></w:document>`);
  expect(new TextDecoder().decode(last.part.blob)).toBe(`<w:${kind === "header" ? "hdr" : "ftr"} xmlns:w="${w}">${paragraph("海岸 🌊")}</w:${kind === "header" ? "hdr" : "ftr"}>`);
  expect(document.part.rels.at("story").target_part.partname.toString()).toBe("/word/story.xml");
  expect(last.is_linked_to_previous).toBe(false);
  expect(retained.text).toBe("海岸 🌊");
  retained.add_run(" checked").bold = false;
  await document.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext);
  expect(reopened.sections[0]![key].is_linked_to_previous).toBe(true);
  expect(reopened.sections[1]![key].paragraphs[0]!.text).toBe("海岸 🌊 checked");
  last.is_linked_to_previous = true;
  expect(document.part.rels.get("story")).toBeNull();
  expect(document.store.snapshot().members.some(member => member.name === "word/story.xml")).toBe(false);
  expect(() => retained.text).toThrow();
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});
