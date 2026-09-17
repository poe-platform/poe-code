import { expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { convert, readDocument } from "./engine.js";
import { createPandocCommand } from "./safe-bash.js";
import type { ConversionContext } from "./types.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const read = (s: string, context: ConversionContext = {}) => readDocument({bytes: bytes(s), source: "/book/main.rst", base: "/book"}, {from: "rst"}, context);
const json = (s: string, policy = {}, context: ConversionContext = {}) => convert([{bytes: bytes(s), source: "/book/main.rst", base: "/book"}], {from: "rst", to: "json", ...policy}, context);
const str = (c: string) => ({t: "Str", c});
const para = (c: string) => ({t: "Para", c: [str(c)]});
it("assigns heading levels by adornment encounter, distinguishing overlines", async () => {
  const doc = await read("======\nTitle\n======\n\nPart\n----\n\nOther\n======\n\nAgain\n-----");
  expect(doc.blocks.filter(b => b.t === "Header").map(b => b.c[0])).toEqual([1, 2, 3, 2]);
});
it("rejects conflicting/short adornments with source positions", async () => {
  for (const s of ["=====\nTitle\n-----", "Long title\n==="]) await expect(read(s)).rejects.toMatchObject({code: "E_PARSE", format: "rst", location: expect.stringContaining("/book/main.rst:")});
});
it("accepts short title adornments and distinguishes short punctuation from transitions", async () => {
  expect((await read("Hi\n==\n\n.\n\n----\n\nbody")).blocks.map(b => b.t)).toEqual(["Header", "Para", "HorizontalRule", "Para"]);
});
it("honors paragraph blank lines and indented block quotes", async () => {
  expect((await read("one\ntwo\n\n  quote\n\n  second\n\nlast")).blocks).toEqual([
    {t: "Para", c: [str("one"), {t: "SoftBreak"}, str("two")]}, {t: "BlockQuote", c: [para("quote"), para("second")]}, para("last")
  ]);
  await expect(read("one\ntwo\n  unexpected")).rejects.toMatchObject({code: "E_PARSE"});
});
it("parses nested bullet and enumerated lists with continuation paragraphs", async () => {
  const doc = await read("* first\n\n  continuation\n\n  3. nested\n  4. next\n\n* second\n\n(a) alpha\n(b) beta");
  expect(doc.blocks[0]?.t).toBe("BulletList");
  if (doc.blocks[0]?.t !== "BulletList") throw new Error("list");
  expect(doc.blocks[0].c[0]?.map(b => b.t)).toEqual(["Para", "Para", "OrderedList"]);
  expect(doc.blocks[1]?.t === "OrderedList" && doc.blocks[1].c[0]).toEqual([1, "LowerAlpha", "TwoParens"]);
});
it("uses the content column for variable list marker spacing", async () => {
  const doc = await read("*   first\n    continuation\n\n10.   numbered\n      continuation");
  expect(doc.blocks[0]?.t === "BulletList" && doc.blocks[0].c[0]?.map(b => b.t)).toEqual(["Para"]);
  expect(doc.blocks[1]?.t === "OrderedList" && doc.blocks[1].c[1][0]?.map(b => b.t)).toEqual(["Para"]);
});
it("maps definition and multiline field lists without losing descriptions", async () => {
  const doc = await read("term : classifier\n  meaning\n\nother\n  explanation\n\n:author: Ada\n:detail:\n  first\n\n  second");
  expect(doc.blocks.map(b => b.t)).toEqual(["DefinitionList", "DefinitionList"]);
  expect(JSON.stringify(doc.blocks)).toContain("classifier");
  expect(JSON.stringify(doc.blocks)).toContain("second");
});
it("preserves blank-line separation after an inline field value", async () => {
  const b = (await read(":detail: first\n\n  second")).blocks[0];
  expect(b?.t === "DefinitionList" && b.c[0]?.[1][0]).toEqual([para("first"), para("second")]);
});
it("preserves unsupported structural replacement bodies instead of flattening paragraphs", async () => {
  const source = ".. |x| replace:: first\n\n   second paragraph";
  await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  const result = await json(source, {lossy: true});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["rst", source]}]);
});
it("handles literal introducer removal, transitions, quoted literals and line blocks", async () => {
  expect((await read("Example::\n\n  * unparsed\n  next\n\nafter\n\n::\n\n> quoted\n> literal\n\n| first\n| second\n  continued\n|\n| final")).blocks).toEqual([
    para("Example:"), {t: "CodeBlock", c: [["", [], []], "* unparsed\nnext"]}, para("after"),
    {t: "CodeBlock", c: [["", [], []], "> quoted\n> literal"]},
    {t: "LineBlock", c: [[str("first")], [str("second"), {t: "SoftBreak"}, str("continued")], [], [str("final")]]}
  ]);
  expect((await read("Text::\nnot literal")).blocks[0]).toEqual({t: "Para", c: [str("Text::"), {t: "SoftBreak"}, str("not"), {t: "Space"}, str("literal")]});
});
it("parses emphasis, escapes, inline literals and prefix/suffix interpreted roles", async () => {
  const doc = await read("*one* **two** ``a * b`` \\* :sup:`x` `y`:sub: `title` :code:`z` :math:`x+y`");
  expect(doc.blocks[0]?.t === "Para" && doc.blocks[0].c.filter(i => i.t !== "Space").map(i => i.t)).toEqual(["Emph", "Strong", "Code", "Str", "Superscript", "Subscript", "Span", "Code", "Math"]);
});
it("resolves named, implicit, indirect and anonymous links in source order", async () => {
  const doc = await read("Heading\n=======\n\nHeading_ alias_ `first`__ second__ `inline <https://inline.test>`_\n\n.. _alias: destination_\n.. _destination: https://named.test\n.. __: https://first.test\n__ https://second.test");
  const p = doc.blocks.find(b => b.t === "Para");
  expect(p?.t === "Para" && p.c.flatMap(i => i.t === "Link" ? [i.c[2][0]] : [])).toEqual(["#heading", "https://named.test", "https://first.test", "https://second.test", "https://inline.test"]);
});
it("retains internal targets and fails duplicate/unresolved/anonymous mismatches", async () => {
  expect(JSON.stringify((await read(".. _spot:\n\nBody\n\nspot_")).blocks)).toContain('"spot"');
  for (const s of [".. _same: /one\n.. _same: /two", "missing_", "one__\n\n.. __: /a\n.. __: /b", ".. _a: b_\n.. _b: a_\n\na_"]) await expect(read(s)).rejects.toMatchObject({code: "E_PARSE"});
});
it("expands forward and nested substitutions and rejects recursion/undefined names", async () => {
  expect((await read("|outer|\n\n.. |outer| replace:: **|inner|**\n.. |inner| replace:: hello")).blocks).toEqual([{t: "Para", c: [{t: "Strong", c: [str("hello")]}]}]);
  for (const s of ["|missing|", "|a|\n\n.. |a| replace:: |b|\n.. |b| replace:: |a|"]) await expect(read(s)).rejects.toMatchObject({code: expect.stringMatching("E_PARSE|E_LIMIT")});
  await expect(read("|a| |a|\n\n.. |a| replace:: value", {limits: {macros: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("resolves numbered, named auto-number and symbol notes with multiline bodies", async () => {
  const doc = await read("[7]_ [#named]_ [#]_ [*]_ [*]_\n\n.. [7] seven\n\n   second\n.. [#named] named\n.. [#] auto\n.. [*] star\n.. [*] dagger");
  const p = doc.blocks[0];
  expect(p?.t === "Para" && p.c.filter(i => i.t === "Note").map(i => i.c)).toEqual([[para("seven"), para("second")], [para("named")], [para("auto")], [para("star")], [para("dagger")]]);
  await expect(read("[1]_\n\n.. [1] [1]_")).rejects.toMatchObject({code: "E_LIMIT"});
});
it("maps code, image and admonition directives without executing content", async () => {
  const doc = await read(".. code:: typescript\n   :number-lines: 4\n\n   console.log('literal');\n\n.. image:: plot.png\n   :alt: A plot\n   :width: 20px\n\n.. note:: Be careful\n\n   **body**");
  expect(doc.blocks.map(b => b.t)).toEqual(["CodeBlock", "Para", "Div"]);
  expect(doc.blocks[0]).toEqual({t: "CodeBlock", c: [["", ["typescript", "numberLines"], [["startFrom", "4"]]], "console.log('literal');"]});
  expect(JSON.stringify(doc.blocks[1])).toContain("plot.png");
  expect(JSON.stringify(doc.blocks[2])).toContain("Strong");
});
it("uses the directive blank line to separate options from literal body fields", async () => {
  for (const prefix of [".. code:: rst", ".. code:: rst\n   :number-lines: 3"]) {
    const block = (await read(`${prefix}\n\n   :name: literal\n   :file: also literal\n\n   body`)).blocks[0];
    expect(block?.t === "CodeBlock" && block.c[1]).toBe(":name: literal\n:file: also literal\n\nbody");
  }
  const raw = await json(".. raw:: html\n\n   :file: inert text", {rawContent: "retain"});
  expect(raw.kind === "text" && JSON.parse(raw.text).blocks).toEqual([{t: "RawBlock", c: ["html", ":file: inert text"]}]);
  expect((await read(".. note::\n\n   :author: Ada")).blocks[0]?.t === "Div").toBe(true);
  expect(JSON.stringify((await read(".. note::\n\n   :author: Ada")).blocks)).toContain("DefinitionList");
});
it("preserves unknown directive bodies/options and roles under explicit raw policy", async () => {
  const source = ".. mystery:: argument\n   :option: value\n\n   body\n\n   nested\n     child";
  await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
  const result = await json(source, {rawContent: "retain"});
  expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["rst", source]}]);
  expect(result.diagnostics.map(d => d.code)).toEqual(["W_RAW_CONTENT"]);
  for (const role of [":unknown:`body`", "`body`:unknown:"]) {
    await expect(read(role)).rejects.toMatchObject({code: "E_CAPABILITY"});
    const raw = await json(role, {lossy: true});
    expect(raw.kind === "text" && JSON.parse(raw.text).blocks[0].c).toEqual([{t: "RawInline", c: ["rst", role]}]);
    expect(raw.diagnostics[0]?.code).toBe("W_RAW_CONTENT");
  }
});
it("raw file/url options never acquire resources even under loss policy", async () => {
  const resolve = vi.fn(async () => bytes("secret"));
  for (const s of [".. raw:: html\n   :file: secret\n\n   <b>body</b>", ".. raw:: html\n   :url: https://example.test", ".. include:: /etc/passwd", ".. include:: ../secret"]) {
    await expect(json(s, {lossy: true}, {resources: {resolve}})).rejects.toMatchObject({code: "E_CAPABILITY"});
  }
  expect(resolve).not.toHaveBeenCalled();
  const raw = await json(".. raw:: html\n\n   <b>body</b>", {rawContent: "retain"});
  expect(raw.kind === "text" && JSON.parse(raw.text).blocks).toEqual([{t: "RawBlock", c: ["html", "<b>body</b>"]}]);
  expect(raw.diagnostics[0]?.code).toBe("W_RAW_CONTENT");
});
it("includes only explicit memfs resources with nested base and cycle/byte limits", async () => {
  const volume = Volume.fromJSON({"/book/sub/chapter.rst": ".. include:: part.rst", "/book/sub/part.rst": "Included"});
  const resolve = vi.fn(async (id: string, base: string | undefined) => new Uint8Array(volume.readFileSync(`${base}/${id}`) as Buffer));
  expect((await read(".. include:: sub/chapter.rst", {resources: {resolve}})).blocks).toEqual([para("Included")]);
  expect(resolve.mock.calls.map(c => c.slice(0, 2))).toEqual([["sub/chapter.rst", "/book"], ["part.rst", "/book/sub"]]);
  await expect(read(".. include:: missing.rst")).rejects.toMatchObject({code: "E_CAPABILITY"});
  await expect(read(".. include:: loop.rst", {resources: {resolve: async () => bytes(".. include:: ./loop.rst")}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read(".. include:: sub/part.rst", {resources: {resolve}, limits: {resourceBytes: 2}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read(".. include:: sub/part.rst", {resources: {resolve}, limits: {includes: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("parses simple table headers and continuation cells", async () => {
  const doc = await read("=====  =====\nName   Value\n=====  =====\nAda    first\n       second\n\nBob    last\n=====  =====");
  const table = doc.blocks[0];
  expect(table?.t).toBe("Table");
  if (table?.t !== "Table") throw new Error("table");
  expect(table.c[3][1]).toHaveLength(1);
  expect(table.c[4][0]?.[3]).toHaveLength(2);
  expect(JSON.stringify(table.c[4][0]?.[3][0])).toContain("second");
});
it("retains multiple paragraphs within a simple table continuation cell", async () => {
  const b = (await read("=====  =====\nAda    first\n\n       second\nBob    last\n=====  =====")).blocks[0];
  expect(b?.t === "Table" && b.c[4][0]?.[3]).toHaveLength(2);
  expect(b?.t === "Table" && b.c[4][0]?.[3][0]?.[1][1]?.[4]).toEqual([para("first"), para("second")]);
});
it("parses grid table multiline cells, headers and block content", async () => {
  const doc = await read("+-------+-------+\n| Head  | Value |\n+=======+=======+\n| first | one   |\n| next  | two   |\n+-------+-------+\n| * a   | last  |\n| * b   |       |\n+-------+-------+");
  const table = doc.blocks[0];
  expect(table?.t).toBe("Table");
  if (table?.t !== "Table") throw new Error("table");
  expect(table.c[2]).toHaveLength(2);
  expect(table.c[3][1]).toHaveLength(1);
  expect(table.c[4][0]?.[3]).toHaveLength(2);
  expect(JSON.stringify(table)).toContain("BulletList");
  await expect(read("+---+---+\n| a | b\n+---+---+")).rejects.toMatchObject({code: "E_PARSE"});
});
it("enforces parser depth, table and directive limits", async () => {
  await expect(read("  quote", {limits: {depth: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read(".. note:: text", {limits: {directives: 0}})).rejects.toMatchObject({code: "E_LIMIT"});
  await expect(read("===  ===\na    b\n===  ===", {limits: {tableCells: 1}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("expands indentation tabs and preserves blank lines inside literal bodies", async () => {
  expect((await read("::\n\n\tfirst\n\n\tsecond")).blocks).toEqual([{t: "CodeBlock", c: [["", [], []], "first\n\nsecond"]}]);
});
it("resolves image substitutions with alt text and embedded inline targets", async () => {
  const doc = await read("|logo| _`place` place_\n\n.. |logo| image:: logo.png\n   :alt: The logo");
  expect(JSON.stringify(doc)).toContain('"The"');
  expect(JSON.stringify(doc)).toContain('"#place"');
  expect(JSON.stringify(doc)).toContain('"logo.png"');
});
it("resolves named and anonymous hyperlinks around substitution expansions", async () => {
  const doc = await read("|badge|_ |label|__\n\n.. |badge| image:: badge.png\n   :alt: Badge\n.. |label| replace:: **Visit**\n.. _badge: https://badge.test\n.. __: https://visit.test");
  const p = doc.blocks[0];
  expect(p?.t === "Para" && p.c.flatMap(i => i.t === "Link" ? [[i.c[1][0]?.t, i.c[2][0]]] : [])).toEqual([["Image", "https://badge.test"], ["Strong", "https://visit.test"]]);
  await expect(read("|label|_\n\n.. |label| replace:: text")).rejects.toMatchObject({code: "E_PARSE"});
});
it("does not swallow supported directives with unsupported options or bodies", async () => {
  for (const source of [".. code:: ts\n   :unknown: value\n\n   body", ".. image:: x.png\n\n   forbidden body", ".. include:: part.rst\n   :start-line: 2"]) {
    await expect(read(source)).rejects.toMatchObject({code: "E_CAPABILITY"});
    const result = await json(source, {lossy: true});
    expect(result.kind === "text" && JSON.parse(result.text).blocks).toEqual([{t: "RawBlock", c: ["rst", source]}]);
    expect(result.diagnostics[0]?.code).toBe("W_RAW_CONTENT");
  }
});
it("supports figure captions and legends as blocks", async () => {
  const doc = await read(".. figure:: picture.png\n   :alt: picture\n\n   Caption *text*\n\n   Legend paragraph");
  const figure = doc.blocks[0];
  expect(figure?.t).toBe("Figure");
  expect(JSON.stringify(figure)).toContain("Legend");
  expect(JSON.stringify(figure)).toContain("Emph");
});
it("requires blank lines before lists and retains paragraph continuation markup", async () => {
  const blocks = (await read("text\n* continuation\n\n* actual item")).blocks;
  expect(blocks[0]).toEqual({t: "Para", c: [str("text"), {t: "SoftBreak"}, str("*"), {t: "Space"}, str("continuation")]});
  expect(blocks[1]?.t === "BulletList" && blocks[1].c.length).toBe(1);
  expect((await read("term\n  definition\n\nparagraph")).blocks.map(b => b.t)).toEqual(["DefinitionList", "Para"]);
});
it("registers embedded named hyperlink targets and supports quoted reference labels", async () => {
  const doc = await read("site_ `site <https://example.test>`_ `two words`_\n\n.. _`two words`: https://other.test");
  expect(doc.blocks[0]?.t === "Para" && doc.blocks[0].c.flatMap(i => i.t === "Link" ? [i.c[2][0]] : [])).toEqual(["https://example.test", "https://example.test", "https://other.test"]);
});
it("locates malformed interpreted text on its actual line and in included files", async () => {
  await expect(read("first\n:code:`unclosed")).rejects.toMatchObject({code: "E_PARSE", location: "/book/main.rst:2:7"});
  await expect(read(".. include:: part.rst", {resources: {resolve: async () => bytes("first\n:code:`unclosed")}})).rejects.toMatchObject({code: "E_PARSE", location: "/book/part.rst:2:7"});
});
it("rejects duplicate definitions and target cycles even when not referenced", async () => {
  for (const source of [".. |x| replace:: one\n.. |x| replace:: two", ".. [3] one\n.. [3] two", ".. _a: b_\n.. _b: a_"]) await expect(read(source)).rejects.toMatchObject({code: "E_PARSE"});
});
it("extracts included images relative to the included memfs source directory", async () => {
  const volume = Volume.fromJSON({"/book/sub/part.rst": ".. image:: p.png\n   :alt: included", "/book/sub/p.png": "image"});
  const fs = {readFile: async (p: string) => new Uint8Array(volume.readFileSync(p) as Buffer),
    lstat: async (p: string) => ({type: volume.lstatSync(p).isDirectory() ? "directory" : "file"}),
    mkdir: async (p: string) => {volume.mkdirSync(p, {recursive: true});}, writeFile: async (p: string, b: Uint8Array) => {volume.writeFileSync(p, b);}};
  const result = await convert([{bytes: bytes(".. include:: sub/part.rst"), source: "/book/main.rst", base: "/book"}], {from: "rst", to: "html", extractMedia: "/media"}, {resourceFiles: fs, resources: {resolve: async (id, base) => fs.readFile(`${base}/${id}`)}});
  expect(result.kind === "text" && result.text).toContain('src="/media/p.png"');
  expect(volume.readFileSync("/media/p.png", "utf8")).toBe("image");
});
it("bounds substitution expansion before AST completion", async () => {
  await expect(read("|x|\n\n.. |x| replace:: long replacement", {limits: {expandedBytes: 3}})).rejects.toMatchObject({code: "E_LIMIT"});
});
it("converts RST in the thin byte adapter with memfs include and no partial output", async () => {
  const volume = Volume.fromJSON({"/book/part.rst": "**Included**"});
  const stdout = vi.fn(async (_b: Uint8Array) => {}), stderr = vi.fn(async (_b: Uint8Array) => {});
  const fs = {readFile: async (p: string) => new Uint8Array(volume.readFileSync(p) as Buffer),
    lstat: async (p: string) => ({type: volume.lstatSync(p).isDirectory() ? "directory" : "file"}),
    mkdir: async (p: string) => {volume.mkdirSync(p, {recursive: true});}, writeFile: async (p: string, b: Uint8Array) => {volume.writeFileSync(p, b);}};
  const ctx = {args: ["-f", "rst", "-t", "html"], stdin: [bytes(".. include:: part.rst")], cwd: "/book", fs, stdout: {write: stdout}, stderr: {write: stderr}, signal: new AbortController().signal};
  expect(await createPandocCommand().execute(ctx)).toEqual({exitCode: 0});
  expect(new TextDecoder().decode(stdout.mock.calls[0]?.[0])).toBe("<p><strong>Included</strong></p>\n");
  stdout.mockClear();
  expect(await createPandocCommand().execute({...ctx, args: [...ctx.args, "-o", "failed.html"], stdin: [bytes(".. include:: missing.rst")]})).toEqual({exitCode: 9});
  expect(volume.existsSync("/book/failed.html")).toBe(false);
  expect(stdout).not.toHaveBeenCalled();
});
