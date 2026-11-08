// Separate standards conformance lane; never imported by workspace unit tasks.
// Corpus attribution and license: docs/pandoc/commonmark-conformance-license.md.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readDocument } from "../dist/index.js";

const corpus = await readFile(new URL("../../../docs/pandoc/commonmark-0.31.2-examples.json", import.meta.url));
assert.equal(createHash("sha256").update(corpus).digest("hex"), "d431b29d97b6f73e69d547109cf5081578fac931e72afe95639ebe766c1b2a20", "Pinned normative corpus bytes");
const examples = JSON.parse(corpus.toString("utf8"));
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
// Projection only: it does not interpret Markdown. Expected output is the
// independently licensed normative HTML, never a reader/writer round trip.
function alt(nodes) {
  return nodes.map((node) => {
    switch (node.t) {
      case "Str": return node.c;
      case "Space": return " ";
      case "SoftBreak": case "LineBreak": return "\n";
      case "Code": return node.c[1];
      case "RawInline": return node.c[1];
      case "Emph": case "Strong": return alt(node.c);
      case "Link": case "Image": return alt(node.c[1]);
      default: throw new Error(`Unmapped alt constructor: ${node.t}`);
    }
  }).join("");
}
function inline(nodes) {
  return nodes.map((node) => {
    switch (node.t) {
      case "Str": return escape(node.c);
      case "Space": return " ";
      case "SoftBreak": return "\n";
      case "LineBreak": return "<br />\n";
      case "Code": return `<code>${escape(node.c[1])}</code>`;
      case "RawInline": assert.equal(node.c[0], "html"); return node.c[1];
      case "Emph": return `<em>${inline(node.c)}</em>`;
      case "Strong": return `<strong>${inline(node.c)}</strong>`;
      case "Link": case "Image": {
        const title = node.c[2][1] ? ` title="${escape(node.c[2][1])}"` : "";
        return node.t === "Link" ? `<a href="${escape(node.c[2][0])}"${title}>${inline(node.c[1])}</a>` : `<img src="${escape(node.c[2][0])}" alt="${escape(alt(node.c[1]))}"${title} />`;
      }
      default: throw new Error(`Unmapped inline constructor: ${node.t}`);
    }
  }).join("");
}
function blocks(nodes) {
  return nodes.map((node) => {
    switch (node.t) {
      case "Plain": return inline(node.c);
      case "Para": return `<p>${inline(node.c)}</p>\n`;
      case "Header": return `<h${node.c[0]}>${inline(node.c[2])}</h${node.c[0]}>\n`;
      case "HorizontalRule": return "<hr />\n";
      case "RawBlock": assert.equal(node.c[0], "html"); return node.c[1];
      case "CodeBlock": return `<pre><code${node.c[0][1].length ? ` class="language-${escape(node.c[0][1][0])}"` : ""}>${escape(node.c[1])}</code></pre>\n`;
      case "BlockQuote": return `<blockquote>\n${blocks(node.c)}</blockquote>\n`;
      case "BulletList": case "OrderedList": {
        const ordered = node.t === "OrderedList";
        const tag = ordered ? "ol" : "ul";
        const items = ordered ? node.c[1] : node.c;
        const start = ordered && node.c[0][0] !== 1 ? ` start="${node.c[0][0]}"` : "";
        return `<${tag}${start}>\n${items.map((item) => {
          const content = item.map((block, index) => blocks([block]) + (block.t === "Plain" && index < item.length - 1 ? "\n" : "")).join("");
          const prefix = item.length && item[0].t !== "Plain" ? "\n" : "";
          return `<li>${prefix}${content}</li>\n`;
        }).join("")}</${tag}>\n`;
      }
      default: throw new Error(`Unmapped block constructor: ${node.t}`);
    }
  }).join("");
}
let failures = 0;
const sections = new Map();
assert.equal(examples.length, 652, "Pinned CommonMark 0.31.2 corpus must be complete");
assert.deepEqual(examples.map((example) => example.example), Array.from({ length: 652 }, (_, index) => index + 1));
for (const example of examples) {
  const section = sections.get(example.section) ?? { total: 0, failed: 0 };
  section.total++;
  sections.set(example.section, section);
  try {
    const document = await readDocument({ bytes: new TextEncoder().encode(example.markdown) }, { from: "commonmark" }, { yield: async () => {} });
    const actual = blocks(document.blocks);
    assert.equal(actual, example.html);
  } catch (error) {
    failures++;
    section.failed++;
    console.error(JSON.stringify({ example: example.example, section: example.section, markdown: example.markdown, expected: example.html, actual: error.actual, error: error.actual === undefined ? error.message : undefined }));
  }
}
console.log(JSON.stringify({ version: "0.31.2", total: examples.length, passed: examples.length - failures, failed: failures, sections: Object.fromEntries(sections) }, null, 2));
process.exitCode = failures ? 1 : 0;
