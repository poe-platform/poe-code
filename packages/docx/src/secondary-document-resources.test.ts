import { expect, it } from "vitest";
import { Document, DocumentPartView } from "./index.js";
import { textContext, w } from "../tests/fixtures/text.js";

it("binds settings and comment resources to their admitted document part", async () => {
  const primary = await Document(undefined, textContext);
  const secondaryPart = await DocumentPartView.load("/word/secondary.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Secondary</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`), primary.part.package);
  const secondary = secondaryPart.document;
  secondary.settings.odd_and_even_pages_header_footer = true;
  expect([...secondaryPart.rels.values()].some(edge => edge.reltype.endsWith("/settings"))).toBe(true);
  expect([...primary.part.rels.values()].some(edge => edge.reltype.endsWith("/settings"))).toBe(false);
  expect(primary.settings.odd_and_even_pages_header_footer).toBe(false);
  expect(secondary.settings.part).not.toBe(primary.settings.part);
  const comment = secondary.add_comment(secondary.paragraphs[0]!.runs[0]!, "Secondary note");
  expect([...secondaryPart.rels.values()].some(edge => edge.reltype.endsWith("/comments"))).toBe(true);
  expect(comment.part).toBe(secondary.comments.get(0)!.part);
  expect(primary.comments.get(0)).toBeNull();
  expect(primary.paragraphs[0]!.text).toBe("");
  expect(secondary.paragraphs[0]!.text).toBe("Secondary");
});

it("rejects comment anchors from another document root in the same package", async () => {
  const primary = await Document(undefined, textContext);
  const part = await DocumentPartView.load("/word/secondary.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Secondary</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`), primary.part.package);
  const run = part.document.paragraphs[0]!.runs[0]!;
  const before = primary.store.snapshot();
  expect(() => primary.add_comment(run, "Wrong owner")).toThrow("document owner");
  expect(primary.store.snapshot()).toEqual(before);
  expect(run.text).toBe("Secondary");
});

it("anchors independent existing comment IDs in their document roots", async () => {
  const primary = await Document(undefined, textContext);
  const primaryRun = primary.add_paragraph("Primary").runs[0]!;
  primary.add_comment(primaryRun, "Primary note");
  const part = await DocumentPartView.load("/word/secondary.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    new TextEncoder().encode(`<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Secondary</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`), primary.part.package);
  const secondary = part.document;
  const comment = secondary.comments.add_comment("Secondary note");
  const run = secondary.paragraphs[0]!.runs[0]!;
  expect(comment.comment_id).toBe(0);
  expect(() => run.mark_comment_range(run, comment.comment_id)).not.toThrow();
  const other = secondary.add_paragraph("Other").runs[0]!;
  expect(() => other.mark_comment_range(other, comment.comment_id)).toThrow("already has an anchor");
});
