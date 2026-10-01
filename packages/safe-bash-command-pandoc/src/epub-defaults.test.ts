import {expect, it} from "vitest";
import {Volume} from "memfs";
import {readDocument, writeDocument} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import type {Document} from "./types.js";

const book: Document = {blocks: [], metadata: {}, resources: []};
const context = {yield: async () => {}};
it.each([{}, {title: "Title"}, {title: "Title", language: "fr"}])("defaults missing EPUB publication metadata without yes: %j", async epub => {
  const result = await writeDocument(book, {to: "epub", epub}, context);
  if (result.kind !== "binary") throw new Error("Expected EPUB");
  const document = await readDocument({bytes: result.bytes}, {from: "epub"}, context);
  expect(document.metadata.title).toEqual({t: "MetaString", c: epub.title ?? "Untitled"});
  expect(document.language).toBe(epub.language ?? "en-US");
  expect(document.metadata.identifier).toEqual({t: "MetaString", c: expect.stringContaining("urn:")});
});
it("accepts explicit EPUB metadata without enabling defaults", async () => {
  const result = await writeDocument(book, {to: "epub", epub: {title: "Title", language: "en", identifier: "urn:original:book"}}, {yield: async () => {}});
  expect(result.kind).toBe("binary");
});
it("keeps typed yes compatible with EPUB defaults", async () => {
  const result = await writeDocument(book, {to: "epub", yes: true}, {yield: async () => {}});
  expect(result.kind).toBe("binary");
});
it("infers the EPUB title from the first heading and preserves explicit metadata", async () => {
  const document: Document = {...book, blocks: [{t: "Div", c: [["", [], []], [{t: "Header", c: [1, ["", [], []], [{t: "Strong", c: [{t: "Str", c: "Orchard"}]}]]}]]}]};
  for (const title of [undefined, "Explicit"]) {
    const result = await writeDocument(document, {to: "epub", epub: {...(title === undefined ? {} : {title}), language: "de", identifier: "urn:book:original"}}, context);
    if (result.kind !== "binary") throw new Error("Expected EPUB");
    const parsed = await readDocument({bytes: result.bytes}, {from: "epub"}, context);
    expect(parsed.metadata.title).toEqual({t: "MetaString", c: title ?? "Orchard"});
    expect(parsed.metadata.identifier).toEqual({t: "MetaString", c: "urn:book:original"});
    expect(parsed.language).toBe("de");
  }
});
it("converts a Markdown file to EPUB without the nonstandard yes flag", async () => {
  const volume = Volume.fromJSON({"/book.md": "# Orchard\n\nA book."});
  const errors: string[] = [];
  const result = await createStandalonePandocCommand().execute({args: ["/book.md", "-o", "/book.epub"], cwd: "/", stdin: [],
    signal: new AbortController().signal,
    readFile: async path => new Uint8Array(volume.readFileSync(path) as Buffer),
    writeFile: async (path, bytes) => {volume.writeFileSync(path, bytes);},
    stdout: {async write() {}}, stderr: {async write(bytes) {errors.push(new TextDecoder().decode(bytes));}}});
  expect({result, errors}).toEqual({result: {exitCode: 0}, errors: []});
  const document = await readDocument({bytes: new Uint8Array(volume.readFileSync("/book.epub") as Buffer)}, {from: "epub"}, context);
  expect(document.metadata.title).toEqual({t: "MetaString", c: "Orchard"});
});
