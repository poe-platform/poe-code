import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createPandocCommand} from "./command.js";

for (const retained of [false, true]) {
  it.each([
    ["markdown", false],
    ["md", false],
    ["markdown+autolink_bare_uris", true],
    ["md+autolink_bare_uris", true],
    ["markdown+autolink_bare_uris-autolink_bare_uris", true],
    ["gfm", true],
    ["gfm-autolink_bare_uris", false]
  ])(`uses the bare-link default and overrides for %s (retained=${retained})`, async (from, links) => {
    const input = {bytes: new TextEncoder().encode("Visit https://example.com and me@example.org.\n")};
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
    const nodes = JSON.parse(output).blocks[0].c;
    if (links) {
      expect(nodes.filter((node: {t: string}) => node.t === "Link").map((node: {c: unknown[]}) => node.c[2])).toEqual([
        ["https://example.com", ""], ["mailto:me@example.org", ""]
      ]);
    } else expect(nodes).toEqual([
      {t: "Str", c: "Visit"}, {t: "Space"},
      {t: "Str", c: "https://example.com"}, {t: "Space"},
      {t: "Str", c: "and"}, {t: "Space"}, {t: "Str", c: "me@example.org."}
    ]);
  });
  for (const from of ["markdown", "md", "markdown-autolink_bare_uris", "commonmark", "gfm"]) {
    it(`preserves autolink attributes for ${from} (retained=${retained})`, async () => {
      const input = {bytes: new TextEncoder().encode("<https://example.com> <a@example.com> [ordinary](https://example.com)\n")};
      for (const to of ["json", "html"]) {
        let output = "";
        if (retained) await convertToOutput([input], {from, to}, {
          workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
          output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
        });
        else {
          const result = await convert([input], {from, to}, {});
          if (result.kind !== "text") throw new Error("Expected text");
          output = result.text;
        }
        const classes = from === "commonmark" || from === "gfm" ? [] : ["uri", "email"];
        if (to === "json") {
          const nodes = JSON.parse(output).blocks[0].c;
          expect(nodes[0].c).toEqual([["", classes.slice(0, 1), []], [{t: "Str", c: "https://example.com"}], ["https://example.com", ""]]);
          expect(nodes[2].c).toEqual([["", classes.slice(1), []], [{t: "Str", c: "a@example.com"}], ["mailto:a@example.com", ""]]);
          expect(nodes[4].c[0]).toEqual(["", [], []]);
        } else {
          expect(output).toContain(`<a href="https://example.com"${classes.length ? ' class="uri"' : ''}>https://example.com</a>`);
          expect(output).toContain(`<a href="mailto:a@example.com"${classes.length ? ' class="email"' : ''}>a@example.com</a>`);
        }
      }
    });
  }
}
it("preserves autolink classes through the public command", async () => {
  for (const to of ["json", "html"]) {
    let output = "", stderr = "";
    const result = await createPandocCommand().execute({
      command: "pandoc", cwd: "/", env: {}, fs: new MemoryFileSystem(),
      args: ["-f", "markdown", "-t", to], stdin: (async function* () {yield new TextEncoder().encode("<https://example.com> <a@example.com>\n");})(),
      signal: new AbortController().signal,
      stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
      stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    if (to === "json") expect(JSON.parse(output).blocks[0].c.filter((node: {t: string}) => node.t === "Link").map((node: {c: unknown[]}) => node.c[0])).toEqual([["", ["uri"], []], ["", ["email"], []]]);
    else {expect(output).toContain('class="uri"'); expect(output).toContain('class="email"');}
  }
});
