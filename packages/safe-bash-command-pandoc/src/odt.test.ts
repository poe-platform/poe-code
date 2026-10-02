import "docx/pandoc-adapter";
import {expect, it} from "vitest";
import {Volume} from "memfs";
import {createStoredZipArchive, readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {SaxesParser} from "saxes";
import {encode as jpeg} from "jpeg-js";
import {createFormatRegistry} from "./formats.js";
import {convert, readDocument, writeDocument} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
const encode = (text: string) => new TextEncoder().encode(text);
const context = {yield: async () => {}};
const source = "# Orchard\n\n**Apple** and *pear*, [site](https://example.com).\n\n- One\n- Two\n\n3. Three\n\n> Quote\n\n---\n\n| A | B |\n|---|---|\n| x | y |\n";

it("registers ODT reading, writing and suffix inference", () => {
  const registry = createFormatRegistry();
  for (const direction of ["read", "write"] as const) {
    expect(registry.infer("report.odt", direction)).toBe("odt");
    expect(registry.list(direction)).toContain("odt");
    expect(registry.resolve("odt", direction)).toBeDefined();
  }
});
it("writes a standard ODT package and round trips document structure", async () => {
  const result = await convert([{bytes: encode(source)}], {from: "gfm", to: "odt"}, context);
  if (result.kind !== "binary") throw new Error("Expected ODT");
  const parts = readZipArchiveEntries(result.bytes);
  expect(new TextDecoder().decode(parts.get("mimetype"))).toBe("application/vnd.oasis.opendocument.text");
  expect(new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint16(8, true)).toBe(0);
  expect(new TextDecoder().decode(result.bytes.subarray(30, 38))).toBe("mimetype");
  for (const [name, bytes] of parts) if (name.endsWith(".xml")) new SaxesParser({xmlns: true}).write(new TextDecoder().decode(bytes)).close();
  const xml = new TextDecoder().decode(parts.get("content.xml"));
  for (const tag of ["text:h", "text:list", "table:table", "text:a", "text:span"]) expect(xml).toContain(tag);
  const parsed = await readDocument({bytes: result.bytes}, {from: "odt"}, context);
  for (const tag of ["Header", "BulletList", "OrderedList", "BlockQuote", "HorizontalRule", "Table", "Link", "Strong", "Emph"]) expect(JSON.stringify(parsed.blocks)).toContain(`"t":"${tag}"`);
  const plain = await convert([{bytes: result.bytes}], {from: "odt", to: "plain"}, context);
  expect(plain).toMatchObject({text: expect.stringContaining("Orchard")});
  expect(plain).toMatchObject({text: expect.stringContaining("Three")});
});
it("reads namespace aliases, repeated whitespace and named styles from external ODT content", async () => {
  const bytes = createStoredZipArchive({mimetype: encode("application/vnd.oasis.opendocument.text"),
    "content.xml": encode('<o:document-content xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:t="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><o:body><o:text><t:h t:outline-level="2">Title</t:h><t:p><t:span t:style-name="Bold">A</t:span><t:s t:c="3"/>B<t:tab/>C<t:line-break/>D</t:p></o:text></o:body></o:document-content>'),
    "styles.xml": encode('<o:document-styles xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:s="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:f="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><o:styles><s:style s:name="Bold" s:family="text"><s:text-properties f:font-weight="bold"/></s:style></o:styles></o:document-styles>')});
  const parsed = await readDocument({bytes}, {from: "odt"}, context);
  expect(parsed.blocks[0]).toMatchObject({t: "Header", c: [2, ["", [], []], [{t: "Str", c: "Title"}]]});
  expect(JSON.stringify(parsed.blocks)).toContain('"t":"Strong"');
  expect(JSON.stringify(parsed.blocks)).toContain('"t":"LineBreak"');
  await expect(readDocument({bytes}, {from: "odt"}, {...context, limits: {expandedBytes: 10}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("converts a Markdown file to ODT through the CLI without explicit formats", async () => {
  const fs = Volume.fromJSON({"/input.md": "# Orchard\n\nA report."});
  const errors: string[] = [];
  const result = await createStandalonePandocCommand().execute({args: ["/input.md", "-o", "/report.odt"], cwd: "/", stdin: [], signal: new AbortController().signal,
    stdout: {async write() {}}, stderr: {async write(bytes) {errors.push(new TextDecoder().decode(bytes));}},
    readFile: async path => new Uint8Array(fs.readFileSync(path) as Buffer), writeFile: async (path, bytes) => {fs.writeFileSync(path, bytes);}});
  expect({result, errors}).toEqual({result: {exitCode: 0}, errors: []});
  expect(readZipArchiveEntries(new Uint8Array(fs.readFileSync("/report.odt") as Buffer)).has("content.xml")).toBe(true);
});
it("reads inherited quotation styles from native ODT producers", async () => {
  const bytes = createStoredZipArchive({mimetype: encode("application/vnd.oasis.opendocument.text"),
    "content.xml": encode('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles><style:style style:name="P1" style:family="paragraph" style:parent-style-name="Quotations"/></office:automatic-styles><office:body><office:text><text:p text:style-name="P1">Quote</text:p></office:text></office:body></office:document-content>')});
  const parsed = await readDocument({bytes}, {from: "odt"}, context);
  expect(parsed.blocks).toEqual([{t: "BlockQuote", c: [{t: "Para", c: [{t: "Str", c: "Quote"}]}]}]);
});
it("embeds images using the ODF drawing namespace and preserves dimensions and rich text", async () => {
  const bytes = new Uint8Array(jpeg({width: 2, height: 1, data: Buffer.alloc(8, 255)}, 80).data);
  const result = await writeDocument({blocks: [{t: "Para", c: [
    {t: "Strikeout", c: [{t: "Str", c: "old"}]}, {t: "Superscript", c: [{t: "Str", c: "2"}]}, {t: "Subscript", c: [{t: "Str", c: "n"}]},
    {t: "Image", c: [["", [], [["width", "1in"]]], [{t: "Str", c: "Apple & pear"}], ["fruit.jpg", "Photo"]]}
  ]}], metadata: {title: {t: "MetaString", c: "Orchard"}}, resources: [{id: "fruit.jpg", bytes}]}, {to: "odt"}, context);
  if (result.kind !== "binary") throw new Error("Expected ODT");
  const parts = readZipArchiveEntries(result.bytes);
  const parser = new SaxesParser({xmlns: true});
  const drawings: string[] = [];
  parser.on("opentag", tag => {if (tag.uri === "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0") drawings.push(tag.local);});
  parser.write(new TextDecoder().decode(parts.get("content.xml"))).close();
  expect(drawings).toEqual(["frame", "image"]);
  const parsed = await readDocument({bytes: result.bytes}, {from: "odt"}, context);
  expect(parsed.metadata.title).toEqual({t: "MetaString", c: "Orchard"});
  expect(parsed.resources).toMatchObject([{id: "Pictures/image-1.jpg", bytes}]);
  expect(parsed.blocks[0]).toMatchObject({t: "Para", c: [
    {t: "Strikeout"}, {t: "Superscript"}, {t: "Subscript"},
    {t: "Image", c: [["", [], [["width", "1in"], ["height", "0.5in"]]], [{t: "Str", c: "Apple & pear"}], ["Pictures/image-1.jpg", "Photo"]]}
  ]});
});
it("rejects malformed ODT and observes cancellation and output limits", async () => {
  await expect(readDocument({bytes: encode("not an ODT")}, {from: "odt"}, context)).rejects.toMatchObject({code: "E_PARSE"});
  await expect(convert([{bytes: encode(source)}], {from: "gfm", to: "odt"}, {...context, limits: {outputBytes: 10}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(convert([{bytes: encode(source)}], {from: "gfm", to: "odt"}, {...context, signal: AbortSignal.abort()})).rejects.toMatchObject({code: "E_CANCELLED"});
});

it("loads docx/pandoc-adapter in odt-writer and defers fengari/citeproc chunks from dist/index.js", async () => {
  const fsNode = await import("node:fs");
  const odtWriterSrc = fsNode.readFileSync(new URL("./odt-writer.ts", import.meta.url), "utf8");
  expect(odtWriterSrc).toContain('import("docx/pandoc-adapter")');
  expect(odtWriterSrc).not.toContain('import("docx")');
  const distIndex = fsNode.readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
  expect(distIndex).not.toMatch(/from\s*["'][^"']*(?:fengari|citeproc)[^"']*["']/);
});
