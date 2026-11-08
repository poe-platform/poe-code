import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import type {Inline} from "./ast-types.js";

const cases: [string, Inline[], string][] = [
  ["html", [{t: "RawInline", c: ["html", "<b>hi</b>"]}], "`<b>hi</b>`{=html}\n"],
  ["tex", [{t: "RawInline", c: ["tex", "\\LaTeX{}"]}], "`\\LaTeX{}`{=tex}\n"],
  ["openxml", [{t: "RawInline", c: ["openxml", "`a``b`"]}], "``` `a``b` ```{=openxml}\n"],
  ["spaces", [{t: "RawInline", c: ["html", " hi "]}], "`  hi  `{=html}\n"]
];

it.each(cases)("renders raw %s inlines with format attributes through all public paths", async (_format, inlines, expected) => {
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: inlines}]}));
  for (const to of ["markdown", "md", "gfm+raw_attribute"]) {
    const options = {from: "json", to, failIfWarnings: true};
    expect(await convert([{bytes}], options, {})).toMatchObject({text: expected, diagnostics: []});
    const fs = new MemoryFileSystem(); let text = "";
    const result = await convertToOutput([{bytes}], options, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(chunk) {text += new TextDecoder().decode(chunk);}, async close() {}, async abort() {}}
    });
    expect(text).toBe(expected); expect(result.diagnostics).toEqual([]);
    expect(await fs.readdir("/")).toEqual([]);
    let stdout = "", stderr = "";
    expect(await createStandalonePandocCommand().execute({
      args: ["-f", "json", "-t", to, "--fail-if-warnings"],
      stdin: (async function* () {yield bytes;})(),
      stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}},
      stderr: {async write(chunk) {stderr += new TextDecoder().decode(chunk);}},
      signal: new AbortController().signal
    })).toEqual({exitCode: 0});
    expect(stdout).toBe(expected); expect(stderr).toBe("");
    const roundtrip = await convert([{bytes: new TextEncoder().encode(stdout)}], {from: to, to: "json"}, {});
    expect(roundtrip.kind === "text" && JSON.parse(roundtrip.text).blocks).toEqual([{t: "Para", c: inlines}]);
  }
});
