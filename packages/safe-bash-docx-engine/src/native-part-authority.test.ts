import { expect, it } from "vitest";
import { Document, SettingsPart, StylesPart, CommentsPart } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const role of ["settings", "styles", "comments"] as const)
it(`refuses native ${role} authority on a generic XML lookalike; strict=${strict}`, async () => {
  const input = await textFixture("<w:p/>", { lookalike: { kind: "customXml", xml: `<w:${role} xmlns:w="${w}"/>` } }, strict);
  // The fixture helper declares an opaque nonnative content type for this part.
  const doc = await Document(input, textContext), owner = doc.part.package, revision = owner.revision;
  expect(() => {
    if (role === "settings") return new SettingsPart(owner, "/word/lookalike.xml").settings;
    if (role === "styles") return new StylesPart(owner, "/word/lookalike.xml").styles;
    return new CommentsPart(owner, "/word/lookalike.xml").comments;
  }).toThrow();
  expect(owner.revision).toBe(revision);
  expect(doc.paragraphs).toHaveLength(1);
});
