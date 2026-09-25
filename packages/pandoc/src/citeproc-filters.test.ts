import {expect, it, vi} from "vitest";
import {convert} from "./engine.js";
import {createPandocCommand} from "./safe-bash.js";
import {createCiteprocFilterCapability} from "./citeproc-filters.js";
import {createExecutionContext} from "./execution.js";
import type {Document} from "./types.js";

const style = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Test author-date</title><id>test</id></info><citation><layout prefix="(" suffix=")" delimiter="; "><group delimiter=", "><names variable="author"><name form="short"/></names><date variable="issued"><date-part name="year"/></date></group></layout></citation><bibliography><layout><text variable="title" font-style="italic"/></layout></bibliography></style>';
const locale = '<locale xmlns="http://purl.org/net/xbiblio/csl" xml:lang="en-US"><terms><term name="and">and</term><term name="et-al">et al.</term></terms></locale>';
const references = [{id: "doe", type: "book", title: "A real book", author: [{family: "Doe", given: "Jane"}], issued: {"date-parts": [[2020]]}}];
function input(id = "doe", mode = "NormalCitation") {
  return new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "Cite", c: [[{
    citationId: id, citationPrefix: [], citationSuffix: [], citationMode: {t: mode}, citationNoteNum: 0, citationHash: 0
  }], [{t: "Str", c: "unprocessed"}]]}]}]}));
}
const options = {from: "json", to: "html", filters: [{kind: "citeproc" as const}]};

it("formats genuine citations and bibliography using supplied CSL data", async () => {
  const filters = createCiteprocFilterCapability({style, locale, references});
  const result = await convert([{bytes: input()}], options, {filters});
  expect(result).toMatchObject({kind: "text"});
  if (result.kind !== "text") throw new Error("Expected HTML");
  expect(result.text).toContain("(Doe, 2020)");
  expect(result.text).toContain("<em>A real book</em>");
  expect(result.text).not.toContain("unprocessed");
});

it.each([
  {mode: "SuppressAuthor", expected: "(2020)"},
  {mode: "AuthorInText", expected: "Doe (2020)"}
])("handles $mode using CSL citation modes", async ({mode, expected}) => {
  await expect(convert([{bytes: input("doe", mode)}], options, {
    filters: createCiteprocFilterCapability({style, locale, references})
  })).resolves.toMatchObject({text: expect.stringContaining(expected)});
});

it("renders a note-style citation as a genuine note", async () => {
  const noteStyle = style.replace('class="in-text"', 'class="note"');
  await expect(convert([{bytes: input()}], {...options, to: "json"}, {
    filters: createCiteprocFilterCapability({style: noteStyle, locale, references})
  })).resolves.toMatchObject({text: expect.stringContaining('"t":"Note"')});
});

it("preserves resource and document sidecars and supplied reference data", async () => {
  const document: Document = {
    blocks: [{t: "Para", c: [{t: "Cite", c: [[{citationId: "doe", citationPrefix: [], citationSuffix: [], citationMode: "NormalCitation", citationNoteNum: 0, citationHash: 0}], []]}]}],
    metadata: {title: {t: "MetaString", c: "Audit"}}, resources: [{id: "image", bytes: Uint8Array.of(1)}], language: "en", direction: "rtl"
  };
  const snapshot = JSON.stringify(references);
  const result = await createCiteprocFilterCapability({style, locale, references}).apply(document, {kind: "citeproc"},
    Object.assign(createExecutionContext("convert"), {to: "html"}));
  expect(result.metadata).toBe(document.metadata);
  expect(result.resources).toBe(document.resources);
  expect(result.language).toBe("en");
  expect(result.direction).toBe("rtl");
  expect(JSON.stringify(references)).toBe(snapshot);
  expect(document.blocks).toHaveLength(1);
});

it("returns citation-free documents unchanged", async () => {
  const document: Document = {blocks: [], metadata: {}, resources: []};
  await expect(createCiteprocFilterCapability({style, locale, references}).apply(document, {kind: "citeproc"},
    Object.assign(createExecutionContext("convert"), {to: "html"}))).resolves.toBe(document);
});

it("bounds CSL data and prevents publication", async () => {
  const publish = vi.fn();
  await expect(convert([{bytes: input()}], options, {
    limits: {text: 500}, filters: createCiteprocFilterCapability({style, locale, references}), output: {publish}
  })).rejects.toMatchObject({code: "E_LIMIT"});
  expect(publish).not.toHaveBeenCalled();
});

it("replaces an existing bibliography placeholder instead of duplicating it", async () => {
  const ast = JSON.parse(new TextDecoder().decode(input()));
  ast.blocks.unshift({t: "Div", c: [["refs", [], []], []]});
  const result = await convert([{bytes: new TextEncoder().encode(JSON.stringify(ast))}], options, {
    filters: createCiteprocFilterCapability({style, locale, references})
  });
  if (result.kind !== "text") throw new Error("Expected HTML");
  expect(result.text.split('id="refs"')).toHaveLength(2);
  expect(result.text.indexOf("A real book")).toBeLessThan(result.text.indexOf("(Doe, 2020)"));
});

it("does not duplicate the bibliography when citeproc is repeated", async () => {
  const result = await convert([{bytes: input()}], {...options, filters: [{kind: "citeproc"}, {kind: "citeproc"}]}, {
    filters: createCiteprocFilterCapability({style, locale, references})
  });
  if (result.kind !== "text") throw new Error("Expected HTML");
  expect(result.text.split('id="refs"')).toHaveLength(2);
});

it("fails before publication for an unavailable cited reference", async () => {
  const publish = vi.fn();
  await expect(convert([{bytes: input("missing")}], options, {
    filters: createCiteprocFilterCapability({style, locale, references}), output: {publish}
  })).rejects.toMatchObject({code: "E_AST"});
  expect(publish).not.toHaveBeenCalled();
});

it.each(["-C", "--citeproc"])("executes citation-bearing JSON through %s", async flag => {
  let stdout = "";
  const result = await createPandocCommand({filters: createCiteprocFilterCapability({style, locale, references})}).execute({
    args: ["-f", "json", "-t", "html", flag], stdin: [input()], signal: new AbortController().signal,
    stdout: {write: async bytes => {stdout += new TextDecoder().decode(bytes);}}, stderr: {write: async () => {}}
  });
  expect(result).toEqual({exitCode: 0});
  expect(stdout).toContain("(Doe, 2020)");
  expect(stdout).toContain("<em>A real book</em>");
});

it("processes citation-free and metadata-supplied citation documents with default CiteprocFilterOptions", async () => {
  const filters = createCiteprocFilterCapability();
  await expect(convert([{bytes: new TextEncoder().encode("Hello\n")}], {from: "commonmark", to: "html", filters: [{kind: "citeproc"}]}, {filters})).resolves.toMatchObject({kind: "text", text: "<p>Hello</p>\n"});
  const withMeta = await convert([{bytes: input()}], {...options, metadataJson: [{references}]}, {filters});
  expect(withMeta).toMatchObject({kind: "text"});
  if (withMeta.kind !== "text") throw new Error("Expected HTML");
  expect(withMeta.text).toContain("(Doe, 2020)");
  expect(withMeta.text).toContain("<em>A real book</em>");
});
