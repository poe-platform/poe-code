// Explicit integration lane: never imported by unit tests or product code.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {writeDocument} from "../dist/engine.js";
const a = ["", [], []];
const s = c => ({t: "Str", c});
const p = (...c) => ({t: "Para", c});
const cases = [
  {name: "unicode-heading", blocks: [{t: "Header", c: [1, a, [s("界é")]]}], text: "界é\n===\n", tags: {title: 1}},
  {name: "boundaries", blocks: [p(s("pre"), {t: "Emph", c: [s("word")]}, s("post"))], text: "pre\\ *word*\\ post\n", tags: {emphasis: 1}, plain: "prewordpost"},
  {name: "blocks", blocks: [{t: "CodeBlock", c: [a, ".. directive::\n* literal"]}, {t: "BulletList", c: [[p(s("first")), p(s("continued")), {t: "BulletList", c: [[p(s("child"))]]}]]}, {t: "DefinitionList", c: [[[s("term")], [[p(s("meaning"))]]]]}], text: "::\n\n   .. directive::\n   * literal\n\n* first\n\n  continued\n\n  * child\n\nterm\n   meaning\n", tags: {literal_block: 1, bullet_list: 2, list_item: 2, definition_list: 1}, literal: ".. directive::\n* literal"},
  {name: "references", blocks: [p({t: "Link", c: [a, [s("same")], ["https://one.test", ""]]}, {t: "Space"}, {t: "Link", c: [a, [s("same")], ["https://two.test", ""]]}, {t: "Note", c: [p(s("note"))]})], text: "`same <pc-link-1_>`_ `same <pc-link-2_>`_\\ [1]_\n\n.. _pc-link-1: https://one.test\n\n.. _pc-link-2: https://two.test\n\n.. [1] note\n", tags: {reference: 2, footnote: 1, footnote_reference: 1}, urls: ["https://one.test", "https://two.test"]},
  {name: "table", blocks: [{t: "Table", c: [a, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [a, []], [[a, 0, [], [[a, [[a, "AlignDefault", 1, 1, [p(s("a long cell exceeding any arbitrary fixed column width")), p(s("continuation"))]]]]]]], [a, []]]}], text: ".. list-table::\n   :header-rows: 0\n\n   * - a long cell exceeding any arbitrary fixed column width\n\n       continuation\n", tags: {table: 1, entry: 1, paragraph: 2}},
  {name: "roles-images", blocks: [p({t: "Code", c: [a, "*_.!"]}, {t: "Space"}, {t: "Superscript", c: [s("2")]}, {t: "Space"}, {t: "Subscript", c: [s("i")]}, {t: "Space"}, {t: "Image", c: [a, [s("alt")], ["image.png", ""]]})], text: "``*_.!`` :sup:`2` :sub:`i` |pc-image-1|\n\n.. |pc-image-1| image:: image.png\n   :alt: alt\n", tags: {literal: 1, superscript: 1, subscript: 1, image: 2}},
];
cases.push(
  {name: "literal-image-alt", blocks: [p({t: "Image", c: [a, [s("a_b* [caption]: \\path")], ["image.png", ""]]})], text: "|pc-image-1|\n\n.. |pc-image-1| image:: image.png\n   :alt: a_b* [caption]: \\path\n", tags: {image: 2}, alt: "a_b* [caption]: \\path"},
  {name: "adjacent-containers", blocks: [{t: "BulletList", c: [[p(s("one"))]]}, {t: "BulletList", c: [[p(s("two"))]]}, {t: "BlockQuote", c: [p(s("first"))]}, {t: "BlockQuote", c: [p(s("second"))]}], text: "* one\n\n..\n\n* two\n\n..\n\n   first\n\n..\n\n   second\n", tags: {bullet_list: 2, block_quote: 2}},
  {name: "extended-combining", blocks: [{t: "Header", c: [1, a, [s("a᪰")]]}], text: "a᪰\n=\n", tags: {title: 1}},
  {name: "internal-duplicate", blocks: [p({t: "Link", c: [a, [s("go")], ["#x", ""]]}), {t: "Header", c: [1, ["x", [], []], [s("one")]]}, {t: "Header", c: [2, ["x", [], []], [s("two")]]}], text: "`go <pc-link-1_>`_\n\n.. _pc-id-78:\n\none\n===\n\n.. _pc-id-78-dup-2:\n\ntwo\n---\n\n.. _pc-link-1: pc-id-78_\n", tags: {reference: 1, section: 2}},
  {name: "projected-nesting", lossy: true, blocks: [p({t: "Strong", c: [{t: "Emph", c: [s("nested")]}]})], text: "**nested**\n", tags: {strong: 1, emphasis: 0}},
);
cases.push(
  {name: "transition", blocks: [p(s("before")), {t: "HorizontalRule"}, p(s("after"))], text: "before\n\n----\n\nafter\n", tags: {transition: 1}},
  {name: "deep-headings", blocks: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => ({t: "Header", c: [level, a, [s(String(level))]]})), text: "1\n=\n\n2\n-\n\n3\n~\n\n4\n^\n\n5\n\"\n\n6\n'\n\n7\n+\n\n8\n:\n\n9\n#\n", tags: {section: 9, title: 9}},
);
for(const fixture of cases) {
  const result = await writeDocument({blocks: fixture.blocks, metadata: {}, resources: []}, {to: "rst", lossy: fixture.lossy ?? false}, {});
  assert.equal(result.kind, "text");
  assert.equal(result.text, fixture.text, fixture.name);
  fixture.actual = result.text;
}
const oracle = spawnSync(process.env.PANDOC_DOCUTILS_PYTHON ?? "python3", ["-c", `
import json, sys, docutils, unicodedata
from docutils import nodes
from docutils.core import publish_doctree
assert docutils.__version__ == "0.21.2", docutils.__version__
assert unicodedata.unidata_version == "13.0.0", unicodedata.unidata_version
for fixture in json.load(sys.stdin):
    tree = publish_doctree(fixture["actual"], settings_overrides={"halt_level": 2, "report_level": 2, "file_insertion_enabled": False, "raw_enabled": False, "doctitle_xform": False})
    assert not list(tree.findall(nodes.system_message)), fixture["name"]
    for tag, count in fixture["tags"].items():
        assert len([n for n in tree.findall() if n.tagname == tag]) == count, (fixture["name"], tag, tree.pformat())
    if "plain" in fixture: assert tree.astext() == fixture["plain"], tree.astext()
    if "literal" in fixture: assert next(tree.findall(nodes.literal_block)).astext() == fixture["literal"]
    if "urls" in fixture: assert [n["refuri"] for n in tree.findall(nodes.reference)] == fixture["urls"]
    if "alt" in fixture: assert all(n["alt"] == fixture["alt"] for n in tree.findall(nodes.image)), tree.pformat()
print("docutils 0.21.2: original cases parsed without diagnostics")
`], {input: JSON.stringify(cases), encoding: "utf8"});
if(oracle.error) throw oracle.error;
assert.equal(oracle.status, 0, oracle.stderr);
process.stdout.write(oracle.stdout);
