import { expect, it } from "vitest";
import { Document, StaleHandleError } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";

it("rejects equality queries on a removed comment owner", async () => {
  const document = await Document(undefined, textContext);
  const comments = document.comments;
  const removed = comments.add_comment("Discarded observation");
  const alias = comments.get(removed.comment_id)!;
  const retained = comments.add_comment("Retained observation");
  expect(removed.equals(alias)).toBe(true);
  removed.element.remove();
  expect(comments.get(0)).toBeNull();
  expect(retained.text).toBe("Retained observation");
  expect(() => removed.text).toThrow(StaleHandleError);
  expect(() => removed.equals(alias)).toThrow(StaleHandleError);
  expect(() => retained.equals(removed)).toThrow(StaleHandleError);
  expect(() => removed.equals(null)).toThrow(StaleHandleError);
});

it("rejects equality queries with a removed section owner", async () => {
  const document = await Document(undefined, textContext);
  const removed = document.add_section();
  const first = document.sections.at(0);
  expect(removed.equals(document.sections.at(1))).toBe(true);
  removed.element.remove();
  expect(document.sections.length).toBe(1);
  expect(first.page_width).not.toBeNull();
  expect(() => removed.equals(removed)).toThrow(StaleHandleError);
  expect(() => first.equals(removed)).toThrow(StaleHandleError);
});

it("compares document owner identity and rejects invalidated document handles", async () => {
  const document = await Document(undefined, textContext);
  const another = await Document(undefined, textContext);
  const equals = Reflect.get(document, "equals") as (other: unknown) => boolean;
  expect(equals).toBeTypeOf("function");
  expect(equals.call(document, document.part.document)).toBe(true);
  expect(equals.call(document, another)).toBe(false);
  document.part.element.set_attribute({ namespaceURI: "http://www.w3.org/XML/1998/namespace", localName: "lang" }, "en");
  expect(() => equals.call(document, document)).toThrow(StaleHandleError);
});

it("rejects graph getters and publication from an invalidated document body", async () => {
  const document = await Document(undefined, textContext);
  void document.settings;
  void document.inline_shapes;
  void document.styles;
  void document.comments;
  const part = document.part;
  part.element.set_attribute({ namespaceURI: "http://www.w3.org/XML/1998/namespace", localName: "lang" }, "en");
  const before = document.store.snapshot();
  for (const property of ["part", "element", "styles", "settings", "inline_shapes", "sections", "comments", "core_properties"])
    expect(() => Reflect.get(document, property)).toThrow(StaleHandleError);
  let published = false;
  await expect(document.save({ write: () => { published = true; return Promise.resolve(); } })).rejects.toThrow(StaleHandleError);
  expect(published).toBe(false);
  expect(document.store.snapshot()).toEqual(before);
});
