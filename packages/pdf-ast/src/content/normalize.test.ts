import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosArray, cosDict, cosName, cosStream, dictGet, dictSet } from "../index.js";
import { normalizeContentBytes, normalizeContentChunks } from "./normalize.js";

const encode = (text: string) => new TextEncoder().encode(text);
const content = "q\r\nBI /W 3 /H 1 /BPC 8 /CS /G ID \r\n\r EI\rQ";
const normalized = "q\nBI /W 3 /H 1 /BPC 8 /CS /G ID \r\n\r EI\nQ";

it("preserves inline-image bytes while normalizing content line endings", async () => {
  const bytes = encode(content);
  expect(normalizeContentBytes(bytes)).toEqual(encode(normalized));
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  async function* input() { for (const byte of bytes) yield Uint8Array.of(byte); }
  const chunks = [];
  for await (const chunk of normalizeContentChunks(input(), { fs, directory: "/scratch" })) chunks.push(chunk);
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(encode(normalized));
  expect(await fs.readdir("/scratch")).toEqual([]);
  expect(bytes).toEqual(encode(content));
});

it("normalizes CRLF spanning retained read chunks", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const bytes = encode(" ".repeat(16383) + "\r\nq\rQ");
  async function* input() { yield bytes; }
  const chunks = [];
  for await (const chunk of normalizeContentChunks(input(), { fs, directory: "/scratch" })) chunks.push(chunk);
  expect(new Uint8Array(Buffer.concat(chunks))).toEqual(encode(" ".repeat(16383) + "\nq\nQ"));
  expect(await fs.readdir("/scratch")).toEqual([]);
});

for (const linearize of [false, true]) it(`normalizes compressed content arrays without changing binary streams or the source (linearize=${linearize})`, () => {
  const document = PdfDocument.create(), page = document.addPage();
  const stream = document.cos.allocateObject(cosStream(encode(content), { compress: true, dict: cosDict({ Custom: cosName("keep") }) }));
  dictSet(page.pageDict, "Contents", cosArray([stream]));
  const binary = document.cos.allocateObject(cosStream(Uint8Array.of(0, 13, 10, 13, 255)));
  dictSet(document.cos.resolveDict(document.cos.rootRef)!, "Binary", binary);
  const output = PdfDocument.load(document.save({ normalizeContent: true, linearize }));
  const outputPage = output.getPages()[0]!;
  const array = output.cos.resolve(dictGet(outputPage.pageDict, "Contents"));
  expect(array?.kind).toBe("array");
  const result = array?.kind === "array" ? output.cos.resolve(array.items[0]) : undefined;
  expect(result?.kind).toBe("stream");
  if (result?.kind !== "stream") throw new Error("Missing content stream");
  expect(result.rawBytes).toEqual(encode(normalized));
  expect(dictGet(result.dict, "Custom")).toMatchObject({ decoded: "keep" });
  const untouched = output.cos.resolve(dictGet(output.cos.resolveDict(output.cos.rootRef)!, "Binary"));
  expect(untouched?.kind === "stream" && untouched.rawBytes).toEqual(Uint8Array.of(0, 13, 10, 13, 255));
  const original = document.cos.resolve(stream);
  expect(original?.kind === "stream" && original.decodedBytes).toEqual(encode(content));
});
