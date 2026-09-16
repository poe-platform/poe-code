import { expect, it } from "vitest";
import { Document, Pt } from "./index.js";
import { paragraph, textFixture } from "../tests/fixtures/text.js";

it("retains inherited namespace bindings while editing paragraph formatting", async () => {
  const document = await Document(await textFixture(paragraph("Harbor")));
  const owner = document.paragraphs[0]!;
  owner.paragraph_format.space_before = Pt(7);
  expect(owner.paragraph_format.space_before?.pt).toBe(7);
  owner.paragraph_format.keep_with_next = true;
  expect(owner.paragraph_format.keep_with_next).toBe(true);
  expect(owner.text).toBe("Harbor");
});
