import { expect, test, vi } from "vitest";
import { convert, convertSync } from "./engine.js";
import type { ConversionContext, Document } from "./types.js";

test("a synchronous probe does not start promise-only adapters before normal conversion", async () => {
  const document: Document = { blocks: [{ t: "Para", c: [{ t: "Str", c: "once" }] }], metadata: {}, resources: [] };
  const reader = { format: "commonmark", read: vi.fn(async () => document) };
  const writer = { format: "plain", write: vi.fn(async () => ({ kind: "text" as const, text: "once\n" })) };
  const context: ConversionContext = { reader, writer };
  const inputs = [{ bytes: new TextEncoder().encode("once") }];
  const options = { from: "commonmark", to: "plain" };
  expect(convertSync(inputs, options, context)).toBeUndefined();
  expect(reader.read).not.toHaveBeenCalled();
  expect(writer.write).not.toHaveBeenCalled();
  expect(await convert(inputs, options, context)).toMatchObject({ kind: "text", text: "once\n" });
  expect(reader.read).toHaveBeenCalledTimes(1);
  expect(writer.write).toHaveBeenCalledTimes(1);
});

test("declining a built-in probe preserves the real conversion output", async () => {
  const inputs = [{ bytes: new TextEncoder().encode("# Heading\n\nParagraph.\n") }];
  const options = { from: "commonmark", to: "html" };
  expect(convertSync(inputs, options)).toBeUndefined();
  const result = await convert(inputs, options, {});
  expect(result).toMatchObject({ kind: "text", text: '<h1 id="heading">Heading</h1>\n<p>Paragraph.</p>\n' });
});
