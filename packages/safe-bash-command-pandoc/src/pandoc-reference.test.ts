// Optional differential checks against the real Pandoc executable. No files or
// services are created. Run with PANDOC_REFERENCE=/path/to/pandoc and a home-backed
// TMPDIR; ordinary unit runs do not require an installed native converter.
// PDF checks additionally use PANDOC_REFERENCE_PDF_ENGINE=/path/to/wkhtmltopdf
// and PANDOC_REFERENCE_PDF_PYTHON=/path/to/python (with pypdfium2 installed).
import {execFileSync} from "node:child_process";
import {expect, it} from "vitest";
import {SaxesParser} from "saxes";
import {createStoredZipArchive, readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert as convertRust} from "@poe-code/document-converter-rust";
import {convert} from "./engine.js";

const reference = process.env.PANDOC_REFERENCE;
const pdfReference = process.env.PANDOC_REFERENCE_PDF_ENGINE;
const pdfInspector = process.env.PANDOC_REFERENCE_PDF_PYTHON;
const encoder = new TextEncoder();
const imageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg==";
type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
const object = (value: Json | undefined): {[key: string]: Json} =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value: Json | undefined): Json[] => Array.isArray(value) ? value : [];
const tag = (value: Json | undefined): string => typeof value === "string" ? value : String(object(value).t ?? "");
const compact = (value: string) => value.split(/\s+/u).filter(Boolean).join(" ");

function plain(value: Json | undefined): string {
  if (value === undefined || value === null || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(plain).join("");
  const node = object(value), content = node.c, parts = array(content);
  switch (node.t) {
    case "Str": return String(content);
    case "Space": case "SoftBreak": return " ";
    case "LineBreak": return "\n";
    case "Code": return String(parts[1]);
    case "CodeBlock": return String(parts[1]) + "\n";
    case "Para": case "Plain": return plain(content) + "\n";
    case "Header": return plain(parts[2]) + "\n";
    case "Link": case "Image": case "Span": case "Cite": case "Quoted": return plain(parts[1]);
    case "OrderedList": return plain(parts[1]);
    case "Div": return plain(parts[1]);
    // DOCX captions are visible paragraphs. Pandoc additionally repeats their
    // text in the table's accessible caption metadata; it is not rendered again.
    case "Table": return plain(parts[3]) + plain(parts[4]) + plain(parts[5]);
    default: return plain(content);
  }
}

function semantics(blocks: Json): Json {
  const headings: Json[] = [], lists: Json[] = [], quotes: Json[] = [], notes: Json[] = [];
  const links: Json[] = [], tables: Json[] = [], marks: Json[] = [], code: Json[] = [];
  let images = 0;
  function visit(value: Json, tableHeader = false, quoteDepth = 0): void {
    if (Array.isArray(value)) {for (const child of value) visit(child, tableHeader, quoteDepth); return;}
    const node = object(value), parts = array(node.c);
    switch (node.t) {
      case "Header": headings.push([parts[0] ?? 0, compact(plain(parts[2]))]); break;
      case "OrderedList": {
        const attrs = array(parts[0]);
        lists.push([attrs[0] ?? 1, tag(attrs[1]), tag(attrs[2]), array(parts[1]).map(item => compact(plain(item)))]); break;
      }
      case "BulletList": lists.push(["bullet", array(node.c).map(item => compact(plain(item)))]); break;
      case "BlockQuote":
        // Pandoc's DOCX writer flattens nested quote styles. Compare the quoted
        // content here; quote indentation is covered by direct writer tests.
        if (quoteDepth === 0) quotes.push(compact(plain(node.c)));
        visit(node.c ?? [], tableHeader, quoteDepth + 1); return;
      case "Note": notes.push(compact(plain(node.c))); break;
      case "Link": {
        const target = array(parts[2]);
        // Heading bookmark names are a writer detail; external destinations are not.
        if (!String(target[0]).startsWith("#")) links.push([compact(plain(parts[1])), target[0] ?? ""]);
        break;
      }
      case "Image": images++; break;
      case "Table": {
        const rows: Json[] = [];
        const add = (rowsValue: Json | undefined) => {
          for (const row of array(rowsValue)) rows.push(array(array(row)[1]).map(cell => {
            const c = array(cell); return [tag(c[1]), c[2] ?? 1, c[3] ?? 1, compact(plain(c[4]))];
          }));
        };
        add(array(parts[3])[1]);
        for (const body of array(parts[4])) {add(array(body)[2]); add(array(body)[3]);}
        add(array(parts[5])[1]); tables.push(rows);
        visit(parts[3] ?? [], true, quoteDepth);
        visit(parts[4] ?? [], false, quoteDepth);
        visit(parts[5] ?? [], false, quoteDepth); return;
      }
      case "CodeBlock": code.push(String(parts[1])); break;
      case "Code": marks.push(["Code", String(parts[1])]); break;
      // Header emphasis can come from inherited table styles or explicit runs.
      case "Strong": if (!tableHeader) marks.push([node.t, compact(plain(node.c))]); break;
      case "Emph": case "Underline": case "Strikeout": case "Superscript": case "Subscript":
        marks.push([node.t, compact(plain(node.c))]); break;
    }
    if (node.c !== undefined) visit(node.c, tableHeader, quoteDepth);
  }
  visit(blocks);
  return {text: compact(plain(blocks)), headings, lists, quotes, notes, links, tables, marks, code, images};
}

function pandoc(args: string[], input: string | Uint8Array): Buffer {
  return execFileSync(reference!, args, {input, maxBuffer: 32 * 1024 * 1024});
}

const cases = [
  ["headings and nested marks", "markdown", "# Main heading\n\n## Smaller heading\n\nNormal **bold**, *italic*, ***both***, ~~struck~~, H~2~O and x^2^. `literal  code` end.\n"],
  ["ordered styles and nested lists", "markdown", "5. Fifth item\n6. Sixth item\n\n   - Nested bullet\n   - Another nested bullet\n\nA) Alpha entry\nB) Beta entry\n\niv. Roman entry\nv. Roman next\n"],
  ["quotations and bullet lists", "markdown", "> First quote paragraph.\n>\n> Second **bold** quote paragraph.\n>\n> > Nested quotation.\n\n- First item\n- Second item\n"],
  ["links, punctuation and Unicode", "markdown", "# Target\n\n[External **link**](https://example.com/a?x=1&y=2) and [internal link](#target).\n\nZażółć gęślą jaźń. Café, naïve, résumé. “Quotes” – —. Ελληνικά Кириллица.\n"],
  ["code whitespace and line breaks", "markdown", "Inline ` a  b ` and `c\\d`.\n\n```text\n  first\n\tsecond\n\nlast <literal> & chars\n```\n\nBefore break.  \nAfter break.\n"],
  ["table alignment and caption", "markdown", "| Left | Center | Right |\n|:---|:---:|---:|\n| **Alpha** | Middle | 12.50 |\n| Empty | | 0 |\n\n: Table caption with *emphasis*.\n"],
  ["notes with lists and table", "markdown", "Main note[^first], second[^second], repeat[^first].\n\n[^first]: Note **bold** and [link](https://example.com/note).\n\n    - Note list first\n    - Note list second\n\n[^second]: | Name | Value |\n    | --- | ---: |\n    | Row | 42 |\n"],
  ["HTML table spans and nested formatting", "html", "<h2>HTML table</h2><p><u>Underlined</u> and <strong><em>both</em></strong>.</p><table><tr><th colspan='2'>Wide header</th><th>Side</th></tr><tr><td rowspan='2'>Tall</td><td align='center'>Middle</td><td align='right'>12</td></tr><tr><td>Bottom</td><td>24</td></tr></table>"],
  ["embedded image", "html", `<p>Before <img alt="small image" src="data:image/png;base64,${imageBase64}"> after.</p>`],
  ["nested image alt text", "commonmark", `![foo ![bar](data:image/png;base64,${imageBase64})](data:image/png;base64,${imageBase64})\n`],
  ["code blocks as list items", "commonmark", "-\t\tfoo\n\n1.      indented code\n"],
  ["block quotes as list items", "commonmark", "> 1. > Blockquote\ncontinued here.\n"],
] as const;

it.skipIf(!reference)("preserves native Pandoc table identifiers as real DOCX bookmarks", async () => {
  const ids = ["table", "head", "headrow", "headcell", "body", "bodyrow", "bodycell", "foot", "footrow", "footcell"];
  const row = (name: string, cell: string) => `<tr id="${name}row"><${cell} id="${name}cell">${name}</${cell}></tr>`;
  const source = `<p>${ids.map(id => `<a href="#${id}">${id}</a>`).join(" ")}</p><table id="table"><caption>Caption</caption><thead id="head">${row("head", "th")}</thead><tbody id="body">${row("body", "td")}</tbody><tfoot id="foot">${row("foot", "td")}</tfoot></table>`;
  const original = JSON.parse(pandoc(["-f", "html", "-t", "json"], source).toString()) as {[key: string]: Json};
  const nativeHtml = pandoc(["-f", "json", "-t", "html"], JSON.stringify(original)).toString();
  for (const id of ids) expect(nativeHtml).toContain(`id="${id}"`);
  const referenceDocx = pandoc(["-f", "json", "-t", "docx"], JSON.stringify(original));
  const referenceXml = new TextDecoder().decode(readZipArchiveEntries(referenceDocx).get("word/document.xml"));
  expect(referenceXml).toContain('w:name="table"');
  // Pandoc 2.19's DOCX writer drops group/row/cell bookmarks even though its
  // HTML writer preserves them. Keep those authored destinations as well.
  const input = {...original, "pandoc-api-version": [1, 23, 1, 2]};
  const result = await convert([{bytes: encoder.encode(JSON.stringify(input))}], {from: "json", to: "docx", yes: true}, {});
  if (result.kind !== "binary") throw Error("Expected DOCX");
  expect(result.diagnostics).toEqual([]);
  const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"));
  for (const id of ids) {
    expect(xml.split(`w:name="${id}"`)).toHaveLength(2);
    expect(xml).toContain(`w:anchor="${id}"`);
  }
});

it.skipIf(!reference).each(cases)("matches native Pandoc DOCX semantics: %s", async (_name, from, source) => {
  const original = JSON.parse(pandoc(["-f", from, "-t", "json"], source).toString()) as {[key: string]: Json};
  const referenceDocx = pandoc(["-f", "json", "-t", "docx", "-o", "-"], JSON.stringify(original));
  // Pandoc 2.x and 3.x use the same constructors in this bounded matrix. Only
  // the envelope version is adapted to the library's explicitly admitted API.
  const input = {...original, "pandoc-api-version": [1, 23, 1, 2]};
  const result = await convert([{bytes: encoder.encode(JSON.stringify(input))}], {from: "json", to: "docx", yes: true}, {
    resources: {resolve: async source => {
      const prefix = "data:image/png;base64,";
      if (!source.startsWith(prefix)) throw Error(`Unexpected test resource: ${source}`);
      return new Uint8Array(Buffer.from(source.slice(prefix.length), "base64"));
    }},
  });
  if (result.kind !== "binary") throw Error("Expected DOCX bytes");
  expect(result.diagnostics).toEqual([]);
  let readbackBytes = result.bytes;
  if (_name === "embedded image" || _name === "nested image alt text") {
    const entries = readZipArchiveEntries(result.bytes), decoder = new TextDecoder();
    const imageParts = [...entries].filter(([name]) => name.startsWith("word/media/"));
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]![1]).toEqual(new Uint8Array(Buffer.from(imageBase64, "base64")));
    const xml = decoder.decode(entries.get("word/document.xml"));
    const descriptions: string[] = [], embeds: string[] = [];
    const rootNamespaces = new Map<string, string>(), localNamespaces = new Map<string, string>();
    let rootName = "";
    const documentParser = new SaxesParser({xmlns: true});
    documentParser.on("opentag", node => {
      if (!rootName) {rootName = node.name; for (const [prefix, uri] of Object.entries(node.ns)) rootNamespaces.set(prefix, uri);}
      for (const [prefix, uri] of Object.entries(node.ns)) {
        if (localNamespaces.has(prefix)) expect(localNamespaces.get(prefix)).toBe(uri);
        localNamespaces.set(prefix, uri);
      }
      if (node.local === "docPr") descriptions.push(node.attributes.descr?.value ?? "");
      if (node.local === "blip") embeds.push(node.attributes["r:embed"]?.value ?? "");
    });
    documentParser.write(xml).close();
    expect(descriptions).toEqual([_name === "nested image alt text" ? "foo bar" : "small image"]);
    expect(embeds).toHaveLength(1);
    const targets: string[] = [];
    const relationshipsParser = new SaxesParser({xmlns: true});
    relationshipsParser.on("opentag", node => {
      if (node.local === "Relationship" && embeds.includes(node.attributes.Id?.value ?? "")) {
        expect(node.attributes.Type?.value).toBe("http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
        expect(node.attributes.TargetMode?.value).not.toBe("External");
        targets.push(`word/${node.attributes.Target?.value ?? ""}`);
      }
    });
    relationshipsParser.write(decoder.decode(entries.get("word/_rels/document.xml.rels"))).close();
    expect(targets).toEqual([imageParts[0]![0]]);
    // Pandoc 2.19's DOCX reader ignores valid drawing namespaces declared below
    // the root. Validate the original XML, image bytes, alt text and relationship
    // above, then hoist identical declarations on a COPY only for that reader.
    if (pandoc(["--version"], "").toString().startsWith("pandoc 2.19")) {
      const missing = [...localNamespaces].filter(([prefix]) => prefix && !rootNamespaces.has(prefix));
      if (missing.length) {
        const declarations = missing.map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`).join("");
        entries.set("word/document.xml", encoder.encode(xml.replace(`<${rootName}`, `<${rootName}${declarations}`)));
        readbackBytes = createStoredZipArchive(Object.fromEntries(entries));
      }
    }
  }
  const expected = JSON.parse(pandoc(["-f", "docx", "-t", "json"], referenceDocx).toString()) as {[key: string]: Json};
  const actual = JSON.parse(pandoc(["-f", "docx", "-t", "json"], readbackBytes).toString()) as {[key: string]: Json};
  expect(semantics(actual.blocks ?? [])).toEqual(semantics(expected.blocks ?? []));
}, 30000);

// These opt-in checks use an independent HTML PDF engine and PDFium reader. All
// input/output travels through pipes; no document files are created by the test.
const pdfCases = [
  ["text and Unicode", "markdown", "# Heading\n\nNormal **bold**, *italic*, ***both*** and `code`.\n\nZażółć gęślą jaźń. Café, naïve, résumé. Ελληνικά Кириллица.\n"],
  ["lists and quotations", "markdown", "> First quoted paragraph.\n>\n> Second quoted paragraph.\n\n1. First entry\n2. Second entry\n\n   - Nested bullet\n   - Another bullet\n"],
  ["table contents", "markdown", "| Left | Center | Right |\n|:---|:---:|---:|\n| Alpha | Middle | 12.50 |\n| Empty | | 0 |\n"],
  ["multiple pages", "markdown", Array.from({length: 90}, (_, index) => `Paragraph ${index + 1}. The quick brown fox jumps over the lazy dog. Every paragraph must remain in order.`).join("\n\n")],
  ["long ordered list marker", "markdown", "123456789. ok\n"],
  ["image with linked alt text", "markdown", `Before ![foo [bar](/url)](data:image/png;base64,${imageBase64}) after.\n`],
  ["uppercase mailto link", "markdown", "<MAILTO:FOO@BAR.BAZ>\n"],
  ["rich table cell blocks", "html", '<table><tr><td><h2>Cell heading</h2><pre><code>Code line\n  Indented line</code></pre><ul><li>List first</li><li>List second</li></ul><blockquote><p>Quoted cell</p></blockquote><hr><p>After rule</p></td></tr></table>'],
  ["nested and merged table cells", "html", '<table><tr><td>Outer cell<table><thead><tr><th colspan="2">Wide header</th><th>Side header</th></tr></thead><tbody><tr><td rowspan="2">Tall cell</td><td>Middle cell</td><td>Right cell</td></tr><tr><td colspan="2">Bottom cell</td></tr></tbody></table></td></tr></table>'],
  ["lower alphabetic list", "html", '<ol type="a" start="3"><li>First item</li><li>Second item</li></ol>'],
  ["upper alphabetic list", "html", '<ol type="A" start="3"><li>First item</li><li>Second item</li></ol>'],
  ["lower Roman list", "html", '<ol type="i" start="3"><li>First item</li><li>Second item</li></ol>'],
  ["upper Roman list", "html", '<ol type="I" start="3"><li>First item</li><li>Second item</li></ol>'],
] as const;

function inspectPdf(bytes: Uint8Array): {text: string; pageTexts: string[]; pages: number; outside: number; links: string[]; images: number} {
  const script = `import ctypes, json, sys
import pypdfium2 as pdfium
pdf = pdfium.PdfDocument(sys.stdin.buffer.read())
texts = []
outside = 0
links = []
images = 0
for page in pdf:
    width, height = page.get_size()
    text = page.get_textpage()
    texts.append(text.get_text_range())
    for index in range(text.count_chars()):
        left, bottom, right, top = text.get_charbox(index)
        if left < -1 or bottom < -1 or right > width + 1 or top > height + 1:
            outside += 1
    position, link = ctypes.c_int(0), pdfium.raw.FPDF_LINK()
    while pdfium.raw.FPDFLink_Enumerate(page, ctypes.byref(position), ctypes.byref(link)):
        action = pdfium.raw.FPDFLink_GetAction(link)
        size = pdfium.raw.FPDFAction_GetURIPath(pdf, action, None, 0) if action else 0
        if size:
            buffer = ctypes.create_string_buffer(size)
            pdfium.raw.FPDFAction_GetURIPath(pdf, action, buffer, size)
            raw = buffer.raw[:size - 1]
            links.append(raw[2:].decode("utf-16-be") if raw.startswith(bytes([254, 255])) else raw.decode("utf-8"))
    images += sum(obj.type == pdfium.raw.FPDF_PAGEOBJ_IMAGE for obj in page.get_objects())
    text.close()
    page.close()
print(json.dumps({"text": "\\n".join(texts), "pageTexts": texts, "pages": len(pdf), "outside": outside, "links": links, "images": images}))
pdf.close()
`;
  return JSON.parse(execFileSync(pdfInspector!, ["-c", script], {input: bytes, maxBuffer: 32 * 1024 * 1024}).toString());
}

it.skipIf(!reference || !pdfReference || !pdfInspector).each(pdfCases)("matches native Pandoc PDF content: %s", async (_name, from, source) => {
  const original = JSON.parse(pandoc(["-f", from, "-t", "json"], source).toString()) as {[key: string]: Json};
  const html = pandoc(["-f", "json", "-t", "html5", "--standalone", "--metadata", "pagetitle=Conversion reference"], JSON.stringify(original));
  // Qt's PDF output cannot open Node's socket-backed stdout pipe. Python gives
  // the reference renderer an ordinary OS pipe while keeping all data in memory.
  const referencePdf = execFileSync(pdfInspector!, ["-c", "import subprocess, sys; sys.stdout.buffer.write(subprocess.check_output(sys.argv[1:], input=sys.stdin.buffer.read()))", pdfReference!, "--quiet", "-", "-"], {input: html, maxBuffer: 32 * 1024 * 1024});
  const input = {...original, "pandoc-api-version": [1, 23, 1, 2]};
  const result = await convert([{bytes: encoder.encode(JSON.stringify(input))}], {from: "json", to: "pdf", yes: true}, {
    resources: {resolve: async source => {
      const prefix = "data:image/png;base64,";
      if (!source.startsWith(prefix)) throw Error(`Unexpected test resource: ${source}`);
      return new Uint8Array(Buffer.from(source.slice(prefix.length), "base64"));
    }},
  });
  if (result.kind !== "binary") throw Error("Expected PDF bytes");
  expect(result.diagnostics).toEqual([]);
  const expected = inspectPdf(referencePdf), actual = inspectPdf(result.bytes);
  // Pagination, fonts and line wrapping can differ. Reading order and all text
  // must survive, and rendered glyphs must remain inside the page bounds.
  // The reference paints bullets as vector shapes; our PDF uses glyphs. Ignore
  // only these line-leading marker characters when comparing extracted text.
  const content = (text: string) => compact(text.normalize("NFKC").replace(/(^|\n)\s*[-•◦]\s/gu, "$1"));
  expect(content(actual.text)).toEqual(content(expected.text));
  const links = (values: string[]) => [...new Set(values.map(value => {
    const colon = value.indexOf(":");
    return colon < 0 ? value : value.slice(0, colon).toLowerCase() + value.slice(colon);
  }))].sort();
  expect(links(actual.links)).toEqual(links(expected.links));
  expect(actual.outside).toBe(0);
  // Qt paints this one-pixel PNG as a vector rectangle. Assert our embedded
  // image against the source fixture rather than its PDF object representation.
  expect(actual.images).toBe(_name === "image with linked alt text" ? 1 : 0);
  if (_name === "multiple pages") expect(actual.pages).toBeGreaterThan(1);
}, 30000);

it.skipIf(!pdfInspector)("keeps all ancestor headers with nested table body fragments", async () => {
  const header = (name: string) => `<thead><tr><th rowspan="2">${name}-L</th><th>${name}-R</th></tr><tr><th>${name}-S</th></tr></thead>`;
  const rows = Array.from({length: 3}, (_, index) => `<tr><td><p>ITEM${index}L</p><p>END${index}L</p></td><td><p>ITEM${index}R</p><p>END${index}R</p></td></tr>`).join("");
  const inner = `<table>${header("INNER")}<tbody>${rows}</tbody></table>`;
  const middle = `<table>${header("MIDDLE")}<tbody><tr><td><p>BEFORE</p>${inner}<p>AFTER</p></td><td>SIDEBODY</td></tr></tbody></table>`;
  const html = `<table><thead><tr><th>OUTER</th></tr></thead><tbody><tr><td>${middle}</td></tr></tbody></table>`;
  const result = await convertRust({mode: "html", format: "pdf", html, options: {pdfPage: {width: 595.28, height: 360, margin: 30}}});
  const actual = inspectPdf(result.bytes);
  expect(actual.outside).toBe(0);
  for (const text of actual.pageTexts) {
    expect(text).toMatch(/BEFORE|AFTER|SIDEBODY|(?:ITEM|END)\d[LR]/u);
    for (const name of ["OUTER", "MIDDLE-L", "MIDDLE-R", "MIDDLE-S"]) expect(text).toContain(name);
    if (/(?:ITEM|END)\d[LR]/u.test(text)) {
      for (const name of ["INNER-L", "INNER-R", "INNER-S"]) expect(text).toContain(name);
    }
  }
  for (let row = 0; row < 3; row++) for (const column of ["L", "R"]) {
    for (const prefix of ["ITEM", "END"]) expect(actual.text.split(`${prefix}${row}${column}`).length - 1).toBe(1);
  }
}, 30000);

it.skipIf(!pdfInspector)("splits an unmerged nested table paragraph across pages without losing words", async () => {
  const tokens = Array.from({length: 150}, (_, index) => `word${String(index).padStart(3, "0")}`);
  const html = `<table><tr><td><table><tr><td>BEGIN ${tokens.join(" ")} END</td></tr></table></td></tr></table>`;
  const result = await convertRust({mode: "html", format: "pdf", html, options: {pdfPage: {width: 595.28, height: 200, margin: 30}}});
  const actual = inspectPdf(result.bytes);
  expect(actual.pages).toBeGreaterThan(1);
  expect(actual.text.match(/word\d{3}/gu)).toEqual(tokens);
  expect(compact(actual.text)).toMatch(/^BEGIN .* END$/u);
  expect(actual.outside).toBe(0);
}, 30000);

it.skipIf(!pdfInspector)("moves a nested table header with its first body fragment near a page boundary", async () => {
  const rows = Array.from({length: 6}, (_, index) => `<tr><td><p>BODY${index}</p><p>END${index}</p></td></tr>`).join("");
  const html = "<p>P</p>".repeat(7) + `<table><thead><tr><th>OUTER</th></tr></thead><tbody><tr><td><table><thead><tr><th>INNER</th></tr></thead><tbody>${rows}</tbody></table></td></tr></tbody></table>`;
  const result = await convertRust({mode: "html", format: "pdf", html, options: {
    pdfPage: {width: 595.28, height: 360, margin: 30}, pdf: {fontSize: 12, lineHeight: 1.65},
  }});
  const actual = inspectPdf(result.bytes);
  for (const text of actual.pageTexts) {
    if (text.includes("OUTER")) expect(text).toMatch(/BODY\d/u);
    if (/BODY\d/u.test(text)) {
      expect(text).toContain("OUTER");
      expect(text).toContain("INNER");
    }
  }
  for (const prefix of ["BODY", "END"]) {
    expect(actual.text.match(new RegExp(`${prefix}\\d`, "gu"))).toEqual(Array.from({length: 6}, (_, index) => `${prefix}${index}`));
  }
  expect(actual.outside).toBe(0);
}, 30000);

it.skipIf(!reference || !pdfInspector)("preserves native Pandoc relative link targets in PDF URI actions", async () => {
  const source = "# Local note\n\n[Related note](README.md)\n";
  const original = JSON.parse(pandoc(["-f", "commonmark", "-t", "json"], source).toString()) as {[key: string]: Json};
  // DOCX preserves authored reference targets. HTML PDF engines can resolve
  // them against their own temporary document URL before writing annotations.
  const referenceDocx = pandoc(["-f", "json", "-t", "docx"], JSON.stringify(original));
  const referenceDocument = JSON.parse(pandoc(["-f", "docx", "-t", "json"], referenceDocx).toString()) as {[key: string]: Json};
  const expectedLinks = array(object(semantics(referenceDocument.blocks ?? [])).links).map(link => String(array(link)[1]));
  expect(expectedLinks).toEqual(["README.md"]);
  const input = {...original, "pandoc-api-version": [1, 23, 1, 2]};
  const result = await convert([{bytes: encoder.encode(JSON.stringify(input))}], {from: "json", to: "pdf", yes: true}, {});
  if (result.kind !== "binary") throw Error("Expected PDF");
  expect(result.diagnostics).toEqual([]);
  const actual = inspectPdf(result.bytes);
  expect(actual.links).toEqual(expectedLinks);
  expect(actual.text).toContain("Related note");
  expect(actual.outside).toBe(0);
});
