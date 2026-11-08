import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createStandalonePandocCommand} from "./safe-bash.js";

it.each([
  {source: '<div id="box">\nText\n</div>\n', kind: "Para", html: '<div id="box"><p>Text</p>\n</div>\n'},
  {source: '<div id="box">Text</div>\n', kind: "Plain", html: '<div id="box">Text</div>\n'}
])("preserves $kind for native div line layout in both readers and the public command", async ({source, kind, html}) => {
  const bytes = new TextEncoder().encode(source);
  const expected = [{t: "Div", c: [["box", [], []], [{t: kind, c: [{t: "Str", c: "Text"}]}]]}];
  for (const to of ["json", "html"]) {
    const result = await convert([{bytes}], {from: "markdown", to}, {});
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("Expected text output");
    if (to === "json") expect(JSON.parse(result.text).blocks).toEqual(expected);
    else expect(result.text).toBe(html);

    const fs = new MemoryFileSystem();
    let retained = "";
    await convertToOutput([{bytes}], {from: "markdown", to}, {
      workingFiles: {fs, directory: "/", cacheBytes: 16384},
      output: {async write(chunk) {retained += new TextDecoder().decode(chunk);}, async close() {}, async abort() {}}
    });
    if (to === "json") expect(JSON.parse(retained).blocks).toEqual(expected);
    else expect(retained).toBe(html);
    expect(await fs.readdir("/")).toEqual([]);

    let stdout = "";
    const status = await createStandalonePandocCommand().execute({
      args: ["-f", "markdown", "-t", to], stdin: [bytes],
      stdout: {async write(chunk) {stdout += new TextDecoder().decode(chunk);}},
      stderr: {async write() {}}, signal: new AbortController().signal
    });
    expect(status).toEqual({exitCode: 0});
    if (to === "json") expect(JSON.parse(stdout).blocks).toEqual(expected);
    else expect(stdout).toBe(html);
  }
});
