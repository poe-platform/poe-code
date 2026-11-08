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
  it(`reads raw fenced blocks (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+raw_attribute", "markdown-fenced_code_attributes"]) {
      for (const [format, content] of [["html", "<details>Hi</details>"], ["tex", "\\LaTeX{}\n\n"], ["openxml", ""]]) {
        expect(JSON.parse(await render('```{=' + format + '}\n' + content + '\n```\n', from)).blocks).toEqual([
          {t: "RawBlock", c: [format, content]}
        ]);
      }
    }
    expect(await render('~~~{=html}\n<details>Hi</details>\n~~~\n', "markdown", "html")).toBe("<details>Hi</details>\n");
  });
  it(`keeps non-raw fenced blocks as code (retained=${retained})`, async () => {
    for (const from of ["markdown-raw_attribute", "commonmark", "gfm"]) {
      expect(JSON.parse(await render('```{=html}\nraw\n```\n', from)).blocks).toEqual([
        {t: "CodeBlock", c: [["", ["{=html}"], []], "raw"]}
      ]);
    }
    for (const info of ["{=}", "{=html}extra", "{=html extra}", "html"]) {
      expect(JSON.parse(await render('```' + info + '\ncode\n```\n')).blocks[0].t).toBe("CodeBlock");
    }
  });
  it(`preserves fenced code attributes (retained=${retained})`, async () => {
    const text = '```{.python #demo .numberLines startFrom="3" title="A sample"}\nprint(1)\n```\n';
    for (const from of ["markdown", "md", "gfm+fenced_code_attributes"]) {
      expect(JSON.parse(await render(text, from)).blocks).toEqual([{t: "CodeBlock", c: [
        ["demo", ["python", "numberLines"], [["startFrom", "3"], ["title", "A sample"]]], "print(1)"
      ]}]);
    }
    const html = await render('```{.python #demo .numberLines title="A sample"}\nprint(1)\n```\n', "markdown", "html");
    expect(html).toContain('id="demo"');
    expect(html).toContain('class="sourceCode python numberSource"');
    expect(html).toContain('<span class="bu">print</span>(<span class="dv">1</span>)');
  });
  it.each([
    {info: "js {.numberLines startFrom=3}", attributes: ["", ["js", "numberLines"], [["startFrom", "3"]]]},
    {info: 'js   {#demo .numberLines startFrom=3 title="A sample"}', attributes: ["demo", ["js", "numberLines"], [["startFrom", "3"], ["title", "A sample"]]]},
    {info: "js {}", attributes: ["", ["js"], []]},
    {info: "js {invalid}", attributes: ["", ["js"], []]},
    {info: "js extra {.numberLines}", attributes: ["", ["js"], []]}
  ])(`preserves attributes after a language in $info (retained=${retained})`, async ({info, attributes}) => {
    for (const from of ["markdown", "md", "gfm+fenced_code_attributes"]) {
      expect(JSON.parse(await render('```' + info + '\nconst x=1;\n```\n', from)).blocks).toEqual([{t: "CodeBlock", c: [attributes, "const x=1;"]}]);
    }
  });
  it.each(["commonmark", "gfm", "markdown-fenced_code_attributes"])(`keeps default info semantics for %s (retained=${retained})`, async from => {
    expect(JSON.parse(await render('```{.python #demo}\nprint(1)\n```\n', from)).blocks[0].c[0]).toEqual(["", ["{.python"], []]);
    expect(JSON.parse(await render('```js {.numberLines startFrom=3}\nconst x=1;\n```\n', from)).blocks[0].c[0]).toEqual(["", ["js"], []]);
  });
  it(`preserves bare languages and empty attributes (retained=${retained})`, async () => {
    expect(JSON.parse(await render('```python\nprint(1)\n```\n')).blocks[0].c[0]).toEqual(["", ["python"], []]);
    expect(JSON.parse(await render('~~~{}\ncode\n~~~\n')).blocks[0].c[0]).toEqual(["", [], []]);
  });
}

it.each([
  {info: "{.python #demo}", block: {t: "CodeBlock", c: [["demo", ["python"], []], "print(1)"]}},
  {info: "{=html}", block: {t: "RawBlock", c: ["html", "print(1)"]}}
])("converts standalone fenced attributes $info", async ({info, block}) => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"],
    stdin: [new TextEncoder().encode('```' + info + '\nprint(1)\n```\n')],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks).toEqual([block]);
});
