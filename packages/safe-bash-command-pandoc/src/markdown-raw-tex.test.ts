import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

for (const retained of [false, true]) {
  async function read(text: string, from = "markdown", to = "json") {
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
  it(`preserves raw TeX commands (retained=${retained})`, async () => {
    for (const from of ["markdown", "md"]) {
      for (const command of ["\\LaTeX{}", "\\alpha", "\\textbf{a {b} c}", "\\foo*[opt]{a}{b}", "\\textbf{a \\} b}"]) {
        const nodes = JSON.parse(await read(`A ${command} command.\n`, from)).blocks[0].c;
        expect(nodes[2]).toEqual({t: "RawInline", c: ["tex", command]});

      }
    }
  });
  it(`applies the existing LaTeX raw-content policy (retained=${retained})`, async () => {
    await expect(read("A \\LaTeX{} command.", "markdown", "latex")).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  });
  it(`handles incomplete arguments and adjacent commands (retained=${retained})`, async () => {
    const nodes = JSON.parse(await read("A \\alpha\\beta{unfinished")).blocks[0].c;
    expect(nodes.slice(2)).toEqual([{t: "RawInline", c: ["tex", "\\alpha"]}, {t: "RawInline", c: ["tex", "\\beta"]}, {t: "Str", c: "{unfinished"}]);
  });
  it(`keeps literal and code content separate (retained=${retained})`, async () => {
    for (const from of ["markdown-raw_tex", "gfm", "commonmark"]) {
      const nodes = JSON.parse(await read("A \\LaTeX{} command.\n", from)).blocks[0].c;
      expect(nodes[2]).toEqual({t: "Str", c: "\\LaTeX{}"});
    }
    for (const text of ["`\\LaTeX{}`", "\\\\LaTeX{}", "\\*literal*"]) {
      expect(await read(text)).not.toContain('"RawInline"');
    }
  });
}

it("preserves raw TeX through the standalone command", async () => {
  let output = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("A \\LaTeX{} command.\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(output).blocks[0].c[2]).toEqual({t: "RawInline", c: ["tex", "\\LaTeX{}"]});
});
