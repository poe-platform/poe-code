import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { TextStore } from "safe-bash-command-html-to-markdown/stored-text";
import { DocumentStore } from "./document-store.js";
import { parseStoredHtml } from "./stored-parser.js";
import { serializeStoredHtml } from "./stored-serializer.js";
import { serializeHtml } from "./serializer.js";
import { selectStoredHtml } from "./stored-selectors.js";
import { selectHtml } from "./selectors.js";
import { parseHtmlSync } from "./tree.js";
import type { HtmlNode } from "./contracts.js";
import { independentFixtures } from "./independent-fixtures.js";

function plain(node: HtmlNode): unknown {
  return { kind: node.kind, name: node.name, data: node.data, namespace: node.namespace,
    attributes: node.attributes.map(a => ({ ...a })), children: node.children.map(plain),
    template: node.templateContents ? plain(node.templateContents) : null };
}

for (const [name, input] of [...independentFixtures.map(([name, input]) => [name, input] as const),
  ["adoption", "<b><i>one</b>two</i><b><p>three</b>four"],
  ["foster", "<table><b>before<tr><td>A<i>B</table>after"],
  ["scope", "<p>A<button><div>B</div></p>C</button><li>D<li>E"],
  ["foreign", '<math><annotation-xml encoding="text/html"><p>X</p></annotation-xml></math><svg><g xml:lang="en"><![CDATA[a<b]]></g></svg>'],
  ["normalization", "\ufeff<p>\r\nx\ufeff\ry</p>"],
  ["script", "<script><!--<script>x</script>--></script><p>end"],
  ["template", "<template><table><b>x<tr><td>y</template><p>z"],
  ["attribute-windows", `<p id="target" class="${"x".repeat(2050)} chosen" data-v="ABC-${"x".repeat(4093)} Needle tail">value</p>`],
  ["markers", "<table><caption><b>a</caption><tr><td><i>b<td>c</table><p>d"],
  ["select", "<select><optgroup><option>a<optgroup><option>b</select><p>c"],
  ["columns", "<table><colgroup>  x<tr><td>y</table>"],
  ["combinator-backtracking", "<section><div><p>A</p><p>B</p>text<p>C</p><aside><p>D</p></aside></div></section><div><p>E</p></div>"],
] as readonly (readonly [string, string])[]) {
  test(`stored tree recovery matches the existing parser: ${name}`, async () => {
    const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
    const options = { signal: new AbortController().signal };
    const storage = new PagedStorage({ fs, cwd: "/scratch", env: {}, ...options }, 2);
    const tree = new DocumentStore(storage), text = new TextStore(storage);
    const string = async (id: number) => { let result = ""; for await (const chunk of text.chunks(id)) result += chunk; return result; };
    const materialize = async (id: number): Promise<unknown> => {
      const node = await tree.read(id), attributes = [], children = [];
      for await (const a of tree.attributes(id)) attributes.push({ name: await string(a.name), value: await string(a.value), namespace: a.namespace });
      for await (const child of tree.children(id)) children.push(await materialize(child));
      return { kind: node.kind, name: await string(node.name), data: await string(node.data), namespace: node.namespace,
        attributes, children, template: node.templateContents ? await materialize(node.templateContents) : null };
    };
    async function* source() { const bytes = new TextEncoder().encode(input); for (let offset = 0; offset < bytes.length; offset += 3) yield bytes.slice(offset, offset + 3); }
    try {
      const root = await parseStoredHtml(source(), tree, text, storage, options);
      const ordinary = parseHtmlSync(input, options);
      assert.deepEqual(await materialize(root), plain(ordinary));
      for (const mode of ["normalized", "pretty"] as const) {
        let rendered = "";
        for await (const piece of serializeStoredHtml(root, tree, text, options, mode)) rendered += piece;
        assert.equal(rendered, serializeHtml(ordinary, options, mode), mode);
      }
      for (const selector of ["*", "p", "body > *", "p + p", "p ~ p", "div p", "body * > p ~ p", "body :not(aside) p", "section > div p + p", "div,p", "[href]", "[id=I]", "[title*=b]", ".chosen", "#target", "[data-v^=abc- i]", "[data-v$=TAIL i]", "[data-v*=Needle]", "[data-v~=Needle]", "[data-v|=ABC]", ":first-child", ":last-child", ":nth-child(2n+1)", ":nth-last-of-type(2)", ":only-of-type", ":not(p)", ":empty", ":root", ":any-link"]) {
        const actual = [];
        for await (const selected of selectStoredHtml(root, selector, tree, text, storage, options)) actual.push(await materialize(selected));
        assert.deepEqual(actual, [...selectHtml(ordinary, selector, options)].map(plain), selector);
      }
    } finally { await storage.close(); }
  });
}
