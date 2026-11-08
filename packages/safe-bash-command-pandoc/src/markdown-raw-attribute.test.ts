import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";

for (const retained of [false, true]) {
  async function render(text: string, from = "markdown", to = "json") {
    const input = {bytes: new TextEncoder().encode(text)};
    if (!retained) {
      const result = await convert([input], {from, to, rawContent: "retain"}, {});
      if (result.kind !== "text") throw new Error("Expected text");
      return result.text;
    }
    let output = "";
    await convertToOutput([input], {from, to, rawContent: "retain"}, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    return output;
  }
  it(`reads typed raw code spans (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm+raw_attribute"]) {
      expect(JSON.parse(await render("`<b>hi</b>`{=html}\n", from)).blocks).toEqual([
        {t: "Para", c: [{t: "RawInline", c: ["html", "<b>hi</b>"]}]}
      ]);
    }
    expect(await render("`<b>hi</b>`{=html}\n", "markdown", "html")).toBe("<p><b>hi</b></p>\n");
  });
  it(`preserves literals and normalizes code whitespace (retained=${retained})`, async () => {
    expect(JSON.parse(await render("`` \\hi &amp; `\nthere ``{=openxml}!")).blocks).toEqual([
      {t: "Para", c: [{t: "RawInline", c: ["openxml", "\\hi &amp; ` there"]}, {t: "Str", c: "!"}]}
    ]);
  });
  it(`leaves disabled and malformed attributes literal (retained=${retained})`, async () => {
    for (const from of ["markdown-raw_attribute", "commonmark", "gfm"]) {
      expect(JSON.parse(await render("`hi`{=html}", from)).blocks).toEqual([
        {t: "Para", c: [{t: "Code", c: [["", [], []], "hi"]}, {t: "Str", c: "{=html}"}]}
      ]);
    }
    for (const suffix of ["{=}", "{=html", "{=html!}"]) {
      expect(JSON.parse(await render("`hi`" + suffix)).blocks).toEqual([
        {t: "Para", c: [{t: "Code", c: [["", [], []], "hi"]}, {t: "Str", c: suffix}]}
      ]);
    }
  });
}
