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
  it(`preserves fenced div attributes and content (retained=${retained})`, async () => {
    const text = '::: {#notice .note .boxed title="A note"}\nText\n:::\n';
    expect(JSON.parse(await render(text)).blocks).toEqual([{t: "Div", c: [
      ["notice", ["note", "boxed"], [["title", "A note"]]], [{t: "Para", c: [{t: "Str", c: "Text"}]}]
    ]}]);
    expect(await render(text, "markdown", "html")).toContain('<div id="notice" class="note boxed" title="A note"><p>Text</p>\n</div>');
  });
  it(`handles nested divs and block content (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render(':::: outer\n\n# Heading\n\n::: {.inner}\n*text*\n:::\n\n- item\n\n::::\n\nAfter\n')).blocks;
    expect(blocks.map((block: {t: string}) => block.t)).toEqual(["Div", "Para"]);
    expect(blocks[0].c[0]).toEqual(["", ["outer"], []]);
    expect(blocks[0].c[1].map((block: {t: string}) => block.t)).toEqual(["Header", "Div", "BulletList"]);
    expect(blocks[0].c[1][1].c[0]).toEqual(["", ["inner"], []]);
  });
  it(`reads divs inside quotes and list items (retained=${retained})`, async () => {
    const blocks = JSON.parse(await render("> ::: note\n> Text\n> :::\n\n- ::: note\n  Text\n  :::\n")).blocks;
    expect(blocks[0].c[0].t).toBe("Div");
    expect(blocks[1].c[0][0].t).toBe("Div");
  });
  it.each(["gfm", "commonmark", "markdown-fenced_divs"])(`keeps div fences literal in %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render("::: {.note}\nText\n:::\n", from)).blocks[0].t).toBe("Para");
  });
  it(`supports explicit enablement, code protection and unclosed divs (retained=${retained})`, async () => {
    expect(JSON.parse(await render("::: note\nText\n", "gfm+fenced_divs")).blocks[0].t).toBe("Div");
    const blocks = JSON.parse(await render("::: note\n```\n::: inner\n:::\n```\n:::\n")).blocks;
    expect(blocks[0].c[1][0]).toEqual({t: "CodeBlock", c: [["", [], []], "::: inner\n:::"]});
  });
}

it("converts the standalone Markdown fenced-div reproduction", async () => {
  let output = "", errors = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"],
    stdin: [new TextEncoder().encode("::: {.note}\nText\n:::\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {errors += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(errors).toBe("");
  expect(output).toBe('<div class="note"><p>Text</p>\n</div>\n');
});
