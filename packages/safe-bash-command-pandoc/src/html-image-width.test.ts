import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {createPandocCommand} from "./command.js";

const json = (width: string, tag = "Image", extra: string[][] = []) => JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "Str", c: "Text"}, {t: "Space"}, {t: tag, c: [["pic", ["photo"], [["width", width], ...extra]], [{t: "Str", c: "Alt"}], ["pic.png", ""]]}, {t: "Space"}, {t: "Str", c: "more."}]}]});
async function render(source: string, retained: boolean) {
  const input = [{bytes: new TextEncoder().encode(source)}], options = {from: "json", to: "html"};
  if (!retained) return convert(input, options, {});
  let text = "";
  const result = await convertToOutput(input, options, {
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  return {...result, text};
}
for (const retained of [false, true]) {
  it.each([["50%", 'style="width:50.0%"'], ["12.5%", 'style="width:12.5%"'], ["2cm", 'style="width:2.0cm"'], ["120px", 'width="120"'], ["120", 'width="120"']])(`renders Image width %s (retained=${retained})`, async (width, expected) => {
    expect(await render(json(width), retained)).toMatchObject({text: `<p>Text <img src="pic.png" alt="Alt" id="pic" class="photo" ${expected}> more.</p>\n`, diagnostics: []});
  });
  it(`rejects invalid, duplicate and non-image widths (retained=${retained})`, async () => {
    for (const source of [json("50%;color:red"), json('50%" onload="x'), json("-1%"), json("Infinity%"), json("50%", "Link"), json("50%", "Image", [["width", "20%"]]), json("50%", "Image", [["style", "color:red"]])]) {
      await expect(render(source, retained)).rejects.toMatchObject({code: "E_CAPABILITY"});
    }
  });
}
it("renders JSON Image width through the public command", async () => {
  let text = "";
  const result = await createPandocCommand().execute({command: "pandoc", args: ["-f", "json", "-t", "html"], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {yield new TextEncoder().encode(json("50%"));})(), stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0); expect(text).toContain('style="width:50.0%"');
});
