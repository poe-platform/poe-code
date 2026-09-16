import { expect, it } from "vitest";
import { Document } from "./document-model.js";
import { textFixture, textContext } from "../tests/fixtures/text.js";
import { CorePropertiesPartView } from "./package-view.js";
it("initializes missing core properties with admitted metadata and one retained owner", async () => {
  const document = await Document(await textFixture("<w:p/>"), {
    ...textContext,
    timestamp: new Date("2026-09-15T12:34:56.900Z"),
    author: "Archivist"
  });
  const properties = document.core_properties;
  expect(properties.revision).toBe(1);
  expect(properties.modified?.toISOString()).toBe("2026-09-15T12:34:56.000Z");
  expect(properties.title).toBe("Document");
  expect(properties.last_modified_by).toBe("Archivist");
  expect(document.core_properties.part).toBe(properties.part);
  expect(CorePropertiesPartView.default(document.part.package)).toBe(properties.part);
});
it("uses the documented deterministic admission timestamp when no clock is supplied", async () => {
  const document = await Document(await textFixture("<w:p/>"), textContext);
  expect(document.core_properties.modified?.toISOString()).toBe("1980-01-01T00:00:00.000Z");
});
