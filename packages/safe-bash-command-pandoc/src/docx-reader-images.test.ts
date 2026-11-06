import "safe-bash-docx-engine";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convertToOutput, writeDocument, convert, readDocument} from "./engine.js";

// Pandoc 3.10.1: Logo ![red](fruit.jpg "Photo"){width=1in} here.
const bytes = readFileSync(new URL("./fixtures/images.docx", import.meta.url));
const fixture = (extension: string) => readFileSync(new URL(`./fixtures/images.${extension}`, import.meta.url), "utf8");

it("preserves native DOCX image position, alt text, title and dimensions", async () => {
  const result = await convert([{bytes}], {from: "docx", to: "json"}, {});
  if (result.kind !== "text") throw new Error("Expected JSON");
  expect(JSON.parse(result.text)).toEqual(JSON.parse(fixture("json")));
});

it.each(["html", "markdown"])("preserves native DOCX images in %s", async to => {
  const result = await convert([{bytes}], {from: "docx", to}, {});
  const native = fixture(to === "markdown" ? "md" : to);
  // Compare through the same reader to ignore equivalent HTML attribute ordering.
  expect(result.kind).toBe("text");
  if (result.kind !== "text") throw new Error("Expected text");
  expect(await convert([{bytes: new TextEncoder().encode(to === "html" ? result.text.split("1.0in").join("1in") : result.text)}], {from: to, to: "json"}, {}))
    .toEqual(await convert([{bytes: new TextEncoder().encode(native)}], {from: to, to: "json"}, {}));
});

it("retains embedded bytes for extraction and subsequent binary conversion", async () => {
  const document = await readDocument({bytes}, {from: "docx"}, {});
  expect(document.resources).toEqual([{id: "media/rId9.jpg", bytes: readZipArchiveEntries(bytes).get("word/media/rId9.jpg")}]);
  const output = await convert([{bytes}], {from: "docx", to: "docx"}, {});
  if (output.kind !== "binary") throw new Error("Expected DOCX");
  expect([...readZipArchiveEntries(output.bytes)].filter(([name]) => name.startsWith("word/media/")).map(([, bytes]) => bytes))
    .toEqual(document.resources.map(resource => resource.bytes));
});

it("enforces image limits while reading DOCX", async () => {
  await expect(readDocument({bytes}, {from: "docx"}, {limits: {images: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
});

it.each(["json", "html", "markdown"].flatMap(to => ["docx", "json"].map(from => ({from, to}))))("keeps streamed $from to $to output consistent", async ({from, to}) => {
  const input = {bytes: from === "docx" ? bytes : new TextEncoder().encode(fixture("json"))};
  let output = "";
  await convertToOutput([input], {from, to}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  const result = await convert([input], {from, to}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  expect(output).toBe(result.text);
});

it("resolves repeated images in footnotes using their owning part", async () => {
  const image = {t: "Image", c: [["", [], []], [{t: "Str", c: "Apple & pear"}], ["fruit.jpg", "Photo"]]} as const;
  const source = await writeDocument({blocks: [{t: "Para", c: [image, {t: "Note", c: [{t: "Para", c: [image, image]}]}]}], metadata: {},
    resources: [{id: "fruit.jpg", bytes: readZipArchiveEntries(bytes).get("word/media/rId9.jpg")!}]}, {to: "docx"}, {});
  if (source.kind !== "binary") throw new Error("Expected DOCX");
  const result = await readDocument({bytes: source.bytes}, {from: "docx"}, {});
  expect(result.resources).toHaveLength(1);
  expect(result.blocks).toMatchObject([{t: "Para", c: [{t: "Image"}, {t: "Note", c: [{t: "Para", c: [
    {t: "Image", c: [expect.anything(), [{t: "Str", c: "Apple"}, {t: "Space"}, {t: "Str", c: "&"}, {t: "Space"}, {t: "Str", c: "pear"}], [result.resources[0]!.id, "Photo"]]}, {t: "Image"}
  ]}]}]}]);
  await expect(readDocument({bytes: source.bytes}, {from: "docx"}, {limits: {images: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("enforces embedded media byte limits", async () => {
  await expect(readDocument({bytes}, {from: "docx"}, {limits: {resourceBytes: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
});
