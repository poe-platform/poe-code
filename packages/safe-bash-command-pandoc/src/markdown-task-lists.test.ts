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
  it(`uses native task-list AST (retained=${retained})`, async () => {
    for (const from of ["markdown", "md", "gfm"]) {
      expect(JSON.parse(await render("- [x] done\n- [ ] todo\n", from)).blocks).toEqual([{
        t: "BulletList", c: [
          [{t: "Plain", c: [{t: "Str", c: "☒"}, {t: "Space"}, {t: "Str", c: "done"}]}],
          [{t: "Plain", c: [{t: "Str", c: "☐"}, {t: "Space"}, {t: "Str", c: "todo"}]}]
        ]
      }]);
    }
  });
  it(`preserves task syntax when writing Markdown (retained=${retained})`, async () => {
    for (const to of ["markdown", "gfm"]) {
      expect(await render("- [x] done\n- [ ] todo\n", "markdown", to)).toBe("- [x] done\n- [ ] todo\n");
    }
  });
  it.each([
    ["- [x] done\n- [ ] todo\n", '<ul class="task-list"><li><label><input type="checkbox" checked="" />done</label></li><li><label><input type="checkbox" />todo</label></li></ul>'],
    ["- [x] done\n- normal\n", '<ul><li><label><input type="checkbox" checked="" />done</label></li><li>normal</li></ul>'],
    ["- normal\n- [x] done\n", '<ul><li>normal</li><li><label><input type="checkbox" checked="" />done</label></li></ul>'],
    ["- [x]\n- [ ]\n", '<ul><li>☒</li><li>☐</li></ul>'],
    ["- [x] done\n\n  extra\n\n- [ ] todo\n", '<ul class="task-list"><li><p><label><input type="checkbox" checked="" />done</label></p><p>extra</p></li><li><p><label><input type="checkbox" />todo</label></p></li></ul>'],
    ["1. [x] done\n2. [ ] todo\n", '<ol type="1"><li><label><input type="checkbox" checked="" />done</label></li><li><label><input type="checkbox" />todo</label></li></ol>'],
    ["- [x] outer\n  - [ ] inner\n", '<ul class="task-list"><li><label><input type="checkbox" checked="" />outer</label><ul class="task-list"><li><label><input type="checkbox" />inner</label></li></ul></li></ul>'],
    ["☒ standalone\n", '<p>☒ standalone</p>']
  ])(`matches native task-list HTML for %j (retained=${retained})`, async (source, expected) => {
    expect((await render(source, "markdown", "html")).replace(/>\s+</g, "><").trim()).toBe(expected);
    const json = await render(source);
    expect((await render(json, "json", "html")).replace(/>\s+</g, "><").trim()).toBe(expected);
  });
}

it("renders task lists through the standalone command", async () => {
  let stdout = "", stderr = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "html"],
    stdin: [new TextEncoder().encode("- [x] done\n- [ ] todo\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toBe('<ul class="task-list">\n<li><label><input type="checkbox" checked="" />done</label></li>\n<li><label><input type="checkbox" />todo</label></li>\n</ul>\n');
});
