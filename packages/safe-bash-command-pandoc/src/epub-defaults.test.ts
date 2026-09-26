import {expect, it, vi} from "vitest";
import {writeDocument} from "./engine.js";
import type {Document} from "./types.js";

const book: Document = {blocks: [], metadata: {}, resources: []};
it.each([{}, {title: "Title"}, {title: "Title", language: "en"}])("requires all EPUB publication metadata without yes: %j", async epub => {
  const publish = vi.fn(async () => {});
  await expect(writeDocument(book, {to: "epub", epub}, {output: {publish}, yield: async () => {}})).rejects.toMatchObject({code: "E_METADATA"});
  expect(publish).not.toHaveBeenCalled();
});
it("accepts explicit EPUB metadata without enabling defaults", async () => {
  const result = await writeDocument(book, {to: "epub", epub: {title: "Title", language: "en", identifier: "urn:original:book"}}, {yield: async () => {}});
  expect(result.kind).toBe("binary");
});
it("allows EPUB defaults only through typed yes", async () => {
  const result = await writeDocument(book, {to: "epub", yes: true}, {yield: async () => {}});
  expect(result.kind).toBe("binary");
});
