import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

for (const retained of [false, true]) {
  async function headings(text: string, from = "markdown") {
    const input = {bytes: new TextEncoder().encode(text)};
    let output = "";
    if (retained) await convertToOutput([input], {from, to: "json"}, {
      workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
      output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
    });
    else {
      const result = await convert([input], {from, to: "json"}, {});
      if (result.kind !== "text") throw new Error("Expected text");
      output = result.text;
    }
    return JSON.parse(output).blocks.map((block: {c: [number, [string, string[], unknown[]]]}) => block.c[1]);
  }
  it(`assigns unique ATX and setext identifiers (retained=${retained})`, async () => {
    expect(await headings("# Hello\n\n# Hello\n\nHello World\n===========\n")).toEqual([
      ["hello", [], []], ["hello-1", [], []], ["hello-world", [], []]
    ]);
  });
  it(`uses GFM base counts, punctuation and Unicode rules (retained=${retained})`, async () => {
    const text = ["Report", "Report", "Report-1", "Report", "Report-1", "33. Hello, World! A_B.C", "École 中文", "!!!", "!!!"].map(title => `## ${title}\n\n`).join("");
    expect((await headings(text, "gfm")).map((attrs: [string]) => attrs[0])).toEqual([
      "report", "report-1", "report-1", "report-2", "report-1-1", "33-hello-world-a_bc", "école-中文", "", "-1"
    ]);
    expect(await headings("# Report\n", "gfm-gfm_auto_identifiers")).toEqual([["", [], []]]);
  });
  it(`uses inline text and native identifier normalization (retained=${retained})`, async () => {
    expect((await headings("# 33. *Hello*, [World](/url) `A_B.C`!\n\n# 123 !!!\n\n# École 中文\n")).map((attrs: [string]) => attrs[0])).toEqual([
      "hello-world-a_b.c", "section", "école-中文"
    ]);
  });
  it(`preserves explicit attributes and avoids prior identifiers (retained=${retained})`, async () => {
    expect(await headings("# First {#hello .wide}\n\n# Hello\n\n# Hello\n\n# Another {.wide}\n")).toEqual([
      ["hello", ["wide"], []], ["hello-1", [], []], ["hello-2", [], []], ["another", ["wide"], []]
    ]);
    expect(await headings("# Hello\n\n# Hello\n", "markdown-auto_identifiers")).toEqual([["", [], []], ["", [], []]]);
    expect(await headings("# Hello {#custom}\n", "markdown-auto_identifiers")).toEqual([["custom", [], []]]);
    expect(await headings("# Hello\n", "md")).toEqual([["hello", [], []]]);
    expect(await headings("# Hello\n", "commonmark")).toEqual([["", [], []]]);
    expect(await headings("# First {#same}\n\n# Second {#same}\n")).toEqual([["same", [], []], ["same", [], []]]);
  });
}

it("exposes identifiers through the standalone command", async () => {
  let output = "", stderr = "";
  const result = await createStandalonePandocCommand().execute({
    args: ["-f", "markdown", "-t", "json"], stdin: [new TextEncoder().encode("# Hello\n\n# Hello\n")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(output).blocks.map((block: {c: [number, [string]]}) => block.c[1][0])).toEqual(["hello", "hello-1"]);
});
