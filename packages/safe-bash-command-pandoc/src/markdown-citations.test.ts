import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

for (const retained of [false, true]) {
  async function read(text: string, from = "markdown") {
    const input = {bytes: new TextEncoder().encode(text)};
    if (!retained) {
      const result = await convert([input], {from, to: "json"}, {});
      if (result.kind !== "text") throw new Error("Expected text");
      return JSON.parse(result.text).blocks[0].c;
    }
    let output = "";
    await convertToOutput([input], {from, to: "json"}, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    return JSON.parse(output).blocks[0].c;
  }
  it(`reads Markdown citation groups (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+citations"]) {
      const nodes = await read("See [@doe2020, p. 4].\n", from);
      expect(nodes[2]).toEqual({t: "Cite", c: [[{
        citationId: "doe2020", citationPrefix: [],
        citationSuffix: [{t: "Str", c: ","}, {t: "Space"}, {t: "Str", c: "p.\u00a04"}],
        citationMode: {t: "NormalCitation"}, citationNoteNum: 1, citationHash: 0
      }], [{t: "Str", c: "[@doe2020,"}, {t: "Space"}, {t: "Str", c: "p."}, {t: "Space"}, {t: "Str", c: "4]"}]]});
      expect(nodes[3]).toEqual({t: "Str", c: "."});
    }
  });
  it(`parses prefixes, formatting and multiple citations (retained=${retained})`, async () => {
    const [node] = await read("[see @doe2020, *p.* 4; -@roe2021]");
    expect(node.t).toBe("Cite");
    expect(node.c[0]).toHaveLength(2);
    expect(node.c[0][0].citationPrefix).toEqual([{t: "Str", c: "see"}]);
    expect(node.c[0][0].citationSuffix[2]).toEqual({t: "Emph", c: [{t: "Str", c: "p."}]});
    expect(node.c[0][1]).toMatchObject({citationId: "roe2021", citationMode: {t: "SuppressAuthor"}});
  });
  it(`reads textual citations and numbers successive groups (retained=${retained})`, async () => {
    const nodes = await read("@doe2020 [p. 4] and [-@roe2021] then @other.");
    const citations = nodes.filter((node: {t: string}) => node.t === "Cite");
    expect(citations.map((node: {c: {citationNoteNum: number}[][]}) => node.c[0]![0]!.citationNoteNum)).toEqual([1, 2, 3]);
    expect(citations[0].c[0][0]).toMatchObject({citationId: "doe2020", citationMode: {t: "AuthorInText"}});
    expect(citations[0].c[0][0].citationSuffix).not.toEqual([]);
    expect(citations[2].c[0][0].citationId).toBe("other");
  });
  it(`preserves disabled, escaped, code and invalid citations (retained=${retained})`, async () => {
    expect(JSON.stringify(await read("---\nbibliography: refs.bib\n---\n\n[@doe2020]", "markdown-citations"))).not.toContain('"Cite"');
    for (const from of ["markdown-citations", "gfm", "commonmark"]) expect(JSON.stringify(await read("[@doe2020, p. 4]", from))).not.toContain('"Cite"');
    for (const text of ["[\\@doe2020]", "`[@doe2020]`", "[@]", "[ordinary text]", "a@b", "[a@b]"]) expect(JSON.stringify(await read(text))).not.toContain('"Cite"');
  });
}

it("reads citations through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("See [@doe2020, p. 4].\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks[0].c[2].t).toBe("Cite");
});
