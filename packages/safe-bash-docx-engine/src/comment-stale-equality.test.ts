import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { textFixture, textContext, w } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";

for (const strict of [false, true]) for (const otherKind of ["null", "number", "string", "self", "alias", "live"] as const)
it(`native removed comment equality rejects ${otherKind}; strict=${strict}`, async () => {
  const input = await textFixture('<w:p><w:r><w:t>Retained 日本 עברית é 🌊</w:t></w:r></w:p>', {
    comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7" w:author="Original"><w:p><w:r><w:t>Removed</w:t></w:r></w:p></w:comment><w:comment w:id="8" w:author="Keep"><w:p><w:r><w:t>Keep</w:t></w:r></w:p></w:comment></w:comments>` }
  }, strict);
  const document = await api.Document(input, textContext), removed = document.comments.get(7)!;
  const other = { null: null, number: 0, string: "different", self: removed, alias: document.comments.get(7)!, live: document.comments.get(8)! }[otherKind];
  removed.element.remove();
  expect(() => removed.equals(other)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
  const memory = Volume.fromJSON({ "/out": "" });
  await document.save({ async write(bytes) { memory.appendFileSync("/out", bytes); } });
  const saved = readPackage(new Uint8Array(memory.readFileSync("/out") as Buffer));
  for (const [name, bytes] of readPackage(input)) if (name !== "word/comments.xml") expect(saved.get(name), name).toEqual(bytes);
  expect(document.comments.get(7)).toBeNull();
  expect(document.comments.get(8)!.text).toBe("Keep");
  expect(document.paragraphs[0]!.text).toBe("Retained 日本 עברית é 🌊");
});

for (const strict of [false, true])
it(`native live comment equality rejects removed same-document operand; strict=${strict}`, async () => {
  const input = await textFixture('<w:p/>', { comments: { kind: "comments", xml: `<w:comments xmlns:w="${w}"><w:comment w:id="7"><w:p/></w:comment><w:comment w:id="8"><w:p/></w:comment></w:comments>` } }, strict);
  const document = await api.Document(input, textContext), removed = document.comments.get(7)!, live = document.comments.get(8)!;
  removed.element.remove();
  expect(() => live.equals(removed)).toThrowError(expect.objectContaining({ code: "stale-selection" }));
});
