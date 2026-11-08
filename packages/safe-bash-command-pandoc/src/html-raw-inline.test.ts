import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";
import type {Inline} from "./ast-types.js";

const cases: [string, Inline[], string][] = [
  ["html", [{t: "RawInline", c: ["html", "<b>hi</b>"]}], "<p><b>hi</b></p>\n"],
  ["html5", [{t: "RawInline", c: ["html5", "<i>hi</i>"]}], "<p><i>hi</i></p>\n"],
  ["tex", [{t: "Str", c: "A"}, {t: "Space"}, {t: "RawInline", c: ["tex", "\\LaTeX{}"]}, {t: "Str", c: "command."}], "<p>A command.</p>\n"],
  ["latex", [{t: "Str", c: "a"}, {t: "RawInline", c: ["latex", "\\unknown{}"]}, {t: "Str", c: "b"}], "<p>ab</p>\n"]
];

it.each(cases)("renders raw %s inlines for both HTML targets and all public paths", async (_format, inlines, expected) => {
  const bytes = new TextEncoder().encode(JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: inlines}]}));
  for (const to of ["html", "html5"]) {
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
  }
});
