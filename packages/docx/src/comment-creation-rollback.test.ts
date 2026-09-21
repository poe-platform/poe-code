import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Document, InvalidValueError } from "./index.js";
import { textContext, textFixture, w } from "../tests/fixtures/text.js";

it.each([
  ["text", "Invalid\u0000content", "Mira", "MR"],
  ["author", "Observation", "Invalid\u0000author", "MR"],
  ["initials", "Observation", "Mira", "Invalid\u0000initials"]
])("rolls back a lazily created style when comment %s is invalid", async (_field, text, author, initials) => {
  const input = await textFixture("<w:p/>", {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"/>` }
  });
  const document = await Document(input, textContext);
  const comments = document.comments;
  const styles = document.styles;
  const before = document.store.snapshot();
  expect(styles.has("Comment Text")).toBe(false);
  expect(() => comments.add_comment(text, author, initials)).toThrow(InvalidValueError);
  expect(document.store.snapshot()).toEqual(before);
  expect(styles.has("Comment Text")).toBe(false);
  expect(comments.length).toBe(0);

  const comment = comments.add_comment("Retained observation", "Mira");
  expect(comment.comment_id).toBe(0);
  expect(comment.text).toBe("Retained observation");
  const volume = Volume.fromJSON({ "/saved": "" });
  await document.save({ async write(bytes) { volume.appendFileSync("/saved", bytes); } });
  const reopened = await Document(new Uint8Array(volume.readFileSync("/saved") as Buffer), textContext);
  expect(reopened.comments.get(0)!.text).toBe("Retained observation");
});
