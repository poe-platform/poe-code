import { expect, it } from "vitest";
import { Volume } from "memfs";
import { openDocumentLocations } from "./index.js";
import { textContext, textFixture } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const depth of [12288, 13000])
it(`rolls back generated after-edit token capacity; strict=${strict}; depth=${depth}`, async () => {
  const bytes = await textFixture("<w:p><w:r><w:t>Original 日本</w:t></w:r></w:p>", {}, strict);
  const memory = Volume.fromJSON({ "/input": Buffer.from(bytes), "/out": "Retain destination" });
  const original = Buffer.from(memory.readFileSync("/input") as Buffer);
  const document = await openDocumentLocations(new Uint8Array(original), textContext);
  const target = document.at("paragraph", 1), before = document.snapshot();
  // Trusted staging receipts mint new metadata; capacity must be checked before
  // resolving the new address, and rejected receipts must not commit staged XML.
  expect(() => document.mutate([target], {}, editor => {
    const xml = editor.xml(target.value.part.slice(1));
    xml.setText(xml.root.children[0]!.children[0]!.children[0]!.children[0]!.content[0]!, "Changed العربية");
    return [{ before: target.token, after: { ...target.value, path: Array<number>(depth).fill(0) } }];
  })).toThrowError(expect.objectContaining({ code: "limit-exceeded" }));
  expect(document.generation).toBe(0);
  expect(document.snapshot()).toEqual(before);
  expect(document.resolve(target.token)).toEqual(target);
  expect(document.text().text).toBe("Original 日本");
  expect(Buffer.from(memory.readFileSync("/input") as Buffer)).toEqual(original);
  expect(String(memory.readFileSync("/out"))).toBe("Retain destination");
});
