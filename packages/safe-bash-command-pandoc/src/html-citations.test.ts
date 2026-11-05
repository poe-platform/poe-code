import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";

it.each(["html", "html5"])("preserves citation identity and escaped IDs in %s through both writers", async to => {
  const cite = (ids: string[], text: string) => ({t: "Cite", c: [ids.map(citationId => ({
    citationId, citationPrefix: [], citationSuffix: [], citationMode: {t: "NormalCitation"}, citationNoteNum: 0, citationHash: 0
  })), [{t: "Emph", c: [{t: "Str", c: text}]}]]});
  const input = {bytes: new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [
    {t: "Para", c: [{t: "Str", c: "See "}, cite(["doe2020"], "[@doe2020, p. 4]"), {t: "Str", c: "."}]},
    {t: "Para", c: [cite(["first", 'a"<&', "日本語"], "citations & text")]},
    {t: "Para", c: [cite([], "empty")]}
  ]}))};
  const expected = '<p>See <span class="citation" data-cites="doe2020"><em>[@doe2020, p. 4]</em></span>.</p>\n'
    + '<p><span class="citation" data-cites="first a&quot;&lt;&amp; 日本語"><em>citations &amp; text</em></span></p>\n'
    + '<p><span class="citation" data-cites=""><em>empty</em></span></p>\n';
  expect(await convert([input], {from: "json", to}, {})).toMatchObject({text: expected});
  let text = "";
  await convertToOutput([input], {from: "json", to}, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  expect(text).toBe(expected);
});
