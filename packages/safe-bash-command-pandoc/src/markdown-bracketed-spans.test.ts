import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {createStandalonePandocCommand} from "./safe-bash.js";
import {convert, convertToOutput} from "./engine.js";

for (const retained of [false, true]) {
  async function render(text: string, from = "markdown", to = "json") {
    const input = {bytes: new TextEncoder().encode(text)};
    if (!retained) {
      const result = await convert([input], {from, to}, {});
      if (result.kind !== "text") throw new Error("Expected text");
      return result.text;
    }
    let output = "";
    await convertToOutput([input], {from, to}, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    return output;
  }
  it(`parses bracketed spans with attributes (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+bracketed_spans"]) {
      expect(JSON.parse(await render('A [marked]{#tag .important .extra title="a } b"} word.\n', from)).blocks[0].c).toEqual([
        {t: "Str", c: "A"}, {t: "Space"},
        {t: "Span", c: [["tag", ["important", "extra"], [["title", "a } b"]]], [{t: "Str", c: "marked"}]]},
        {t: "Space"}, {t: "Str", c: "word."}
      ]);
    }
  });
  it(`preserves nested inline content (retained=${retained})`, async () => {
    const content = JSON.parse(await render('[*outer* [inner]{.inner} [link](url)]{.outer}')).blocks[0].c;
    expect(content[0].t).toBe("Span");
    expect(content[0].c[1].map((node: {t: string}) => node.t)).toEqual(["Emph", "Space", "Span", "Space", "Link"]);
    expect(await render('[marked]{.important}', "markdown", "html")).toBe('<p><span class="important">marked</span></p>\n');
  });
  it(`writes Span attributes without projection (retained=${retained})`, async () => {
    for (const to of ["markdown", "md", "gfm+bracketed_spans"]) {
      for (const text of [
        "A [marked]{.important} word.\n",
        '[*outer* [inner]{.inner}]{#tag .important .extra title="a } b"}\n',
        '[]{.empty}\n',
        '[plain]{}\n',
        String.raw`[marked]{title="a \"quote\" and \\ slash"}` + "\n"
      ]) {
        const json = await render(text);
        expect(await render(json, "json", to)).toBe(text);
      }
    }
  });
  it(`respects disabled bracketed span output (retained=${retained})`, async () => {
    const json = await render('[marked]{.important}');
    for (const to of ["commonmark", "gfm", "markdown-bracketed_spans"]) {
      await expect(render(json, "json", to)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
    }
  });
  it.each(["commonmark", "gfm", "markdown-bracketed_spans"])(`keeps disabled spans literal in %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render('[marked]{.important}', from)).blocks[0].c).toEqual([{t: "Str", c: "[marked]{.important}"}]);
  });
  it(`leaves malformed spans and code intact (retained=${retained})`, async () => {
    for (const text of ['[marked]{.important', '[marked]{invalid}', '[marked] {.important}', String.raw`\[marked]{.important}`]) {
      expect(JSON.parse(await render(text)).blocks[0].c.some((node: {t: string}) => node.t === "Span")).toBe(false);
    }
    expect(JSON.parse(await render('`[marked]{.important}`')).blocks[0].c[0].t).toBe("Code");
    expect(JSON.parse(await render('[]{.empty}')).blocks[0].c).toEqual([{t: "Span", c: [["", ["empty"], []], []]}]);
  });
}

it("converts bracketed spans through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("A [marked]{.important} word.\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks[0].c[2]).toEqual({t: "Span", c: [["", ["important"], []], [{t: "Str", c: "marked"}]]});
});

it("preserves Span classes through JSON command input without warnings", async () => {
  let output = "", diagnostics = "";
  const input = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [
    {t: "Str", c: "A"}, {t: "Space"},
    {t: "Span", c: [["", ["important"], []], [{t: "Str", c: "marked"}]]},
    {t: "Space"}, {t: "Str", c: "word."}
  ]}]});
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "json", "-t", "markdown"], stdin: [new TextEncoder().encode(input)],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {diagnostics += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode, diagnostics).toBe(0);
  expect(output).toBe("A [marked]{.important} word.\n");
  expect(diagnostics).toBe("");
});
