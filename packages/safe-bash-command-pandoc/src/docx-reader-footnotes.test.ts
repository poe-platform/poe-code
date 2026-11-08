import "safe-bash-docx-engine";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {parseFragment, type DefaultTreeAdapterMap} from "parse5";
import {convert} from "./engine.js";

// Generated with Pandoc 3.10.1 from: Text with a note[^1].\n\n[^1]: Footnote text.
const native = readFileSync(new URL("./fixtures/footnote.json", import.meta.url));

// ODT keeps runs of text intact; native Pandoc splits them into Str/Space inlines.
function normalizeText(value: unknown): unknown {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const normalized = normalizeText(item);
      if (typeof normalized === "string" && typeof result.at(-1) === "string") result[result.length - 1] += normalized;
      else result.push(normalized);
    }
    return result;
  }
  if (value && typeof value === "object") {
    if ("t" in value && value.t === "Str" && "c" in value) return value.c;
    if ("t" in value && value.t === "Space") return " ";
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeText(item)]));
  }
  return value;
}

function noteContent(html: string) {
  const links: Record<string, string>[] = [];
  let text = "";
  const visit = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && node.tagName === "a") {
      const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
      links.push({href: attrs.href!, id: attrs.id ?? "", role: attrs.role!});
      if (attrs.role === "doc-backlink") return;
    }
    if ("value" in node) text += node.value.trim();
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parseFragment(html));
  return {links, text};
}

it.each(["docx", "odt"])("reads native Pandoc %s footnotes with JSON and HTML parity", async format => {
  const bytes = readFileSync(new URL(`./fixtures/footnote.${format}`, import.meta.url));
  const json = await convert([{bytes}], {from: format, to: "json"}, {});
  if (json.kind !== "text") throw new Error("Expected JSON");
  if (format === "odt") {
    expect(normalizeText(JSON.parse(json.text).blocks)).toEqual(normalizeText(JSON.parse(native.toString()).blocks));
  } else expect(JSON.parse(json.text)).toEqual(JSON.parse(native.toString()));
  const html = await convert([{bytes}], {from: format, to: "html"}, {});
  expect(html).toEqual(await convert([{bytes: native}], {from: "json", to: "html"}, {}));
  if (html.kind !== "text") throw new Error("Expected HTML");
  const nativeHtml = readFileSync(new URL(format === "odt" ? "./fixtures/footnote-odt.html" : "./fixtures/footnote.html", import.meta.url), "utf8");
  expect(noteContent(html.text)).toEqual(noteContent(nativeHtml));
  const plain = await convert([{bytes}], {from: format, to: "plain"}, {});
  expect(plain).toMatchObject({kind: "text", text: expect.stringContaining("Footnote text.")});
});

it("keeps repeated references in order within a run", async () => {
  const markdown = '`<w:r><w:t>Before</w:t><w:footnoteReference w:id="1"/><w:t>after</w:t></w:r>`{=openxml}[^1]\n\n[^1]: Note text.\n';
  const docx = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "markdown", to: "docx"}, {});
  if (docx.kind !== "binary") throw new Error("Expected DOCX");
  const expected = "Before[^1]after[^1]\n\n[^1]: Note text.\n";
  expect(await convert([{bytes: docx.bytes}], {from: "docx", to: "json"}, {}))
    .toEqual(await convert([{bytes: new TextEncoder().encode(expected)}], {from: "markdown", to: "json"}, {}));
});

it("rejects cyclic footnote references", async () => {
  const markdown = 'Text[^1]\n\n[^1]: `<w:r><w:footnoteReference w:id="1"/></w:r>`{=openxml}';
  const docx = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "markdown", to: "docx"}, {});
  if (docx.kind !== "binary") throw new Error("Expected DOCX");
  await expect(convert([{bytes: docx.bytes}], {from: "docx", to: "json"}, {})).rejects.toMatchObject({code: "E_PARSE"});
});

it("reads table-cell references and tables in footnotes", async () => {
  const markdown = "| Main |\n| --- |\n| Text[^1] |\n\n[^1]: | Note header |\n    | --- |\n    | Note cell |\n";
  const docx = await convert([{bytes: new TextEncoder().encode(markdown)}], {from: "markdown", to: "docx"}, {});
  if (docx.kind !== "binary") throw new Error("Expected DOCX");
  const result = await convert([{bytes: docx.bytes}], {from: "docx", to: "json"}, {});
  if (result.kind !== "text") throw new Error("Expected JSON");
  const document = JSON.parse(result.text);
  const cell = document.blocks[0].c[4][0][3][0][1][0][4];
  expect(cell[0].c[1]).toMatchObject({t: "Note", c: [{t: "Table"}]});
  expect(result.text).toContain('"Note"');
  expect(result.text).toContain('"cell"');
});

it("reads distinct formatted notes, multiple paragraphs, and note hyperlinks", async () => {
  const markdown = "Text[^1] and another[^2].\n\n[^1]: Footnote **text**.\n\n    Second paragraph with [link](https://example.com).\n\n[^2]: Other note.\n";
  const input = [{bytes: new TextEncoder().encode(markdown)}];
  const docx = await convert(input, {from: "markdown", to: "docx"}, {});
  if (docx.kind !== "binary") throw new Error("Expected DOCX");
  expect(await convert([{bytes: docx.bytes}], {from: "docx", to: "json"}, {}))
    .toEqual(await convert(input, {from: "markdown", to: "json"}, {}));
});
