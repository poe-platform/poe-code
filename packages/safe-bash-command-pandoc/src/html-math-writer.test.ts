import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, writeDocument} from "./engine.js";
import {createPandocCommand} from "./command.js";
import type {ConversionContext, ConversionOptions} from "./types.js";

const json = (tex: string, display = false) => JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "Math", c: [{t: display ? "DisplayMath" : "InlineMath"}, tex]}]}]});
async function render(tex: string, retained: boolean, display = false, options: Partial<ConversionOptions> = {}, context: ConversionContext = {}) {
  const inputs = [{bytes: new TextEncoder().encode(json(tex, display))}], conversion = {from: "json", to: "html", ...options};
  if (!retained) return convert(inputs, conversion, context);
  let text = "";
  const result = await convertToOutput(inputs, conversion, {...context,
    workingFiles: {fs: new MemoryFileSystem(), directory: "/", cacheBytes: 16384},
    output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}
  });
  return {...result, text};
}
// Expected fragments verified with Pandoc 3.10.1, -f json -t html --wrap=none.
for (const retained of [false, true]) {
  it.each([
    ["x^2", "<em>x</em><sup>2</sup>"],
    ["-x", "−<em>x</em>"],
    ["x^12", "<em>x</em><sup>12</sup>"],
    ["\\left(x+1\\right)^2", "(<em>x</em> + 1)<sup>2</sup>"],
    ["x^2_i", "<em>x</em><sub><em>i</em></sub><sup>2</sup>"],
    ["x^{ab+2}", "<em>x</em><sup><em>a</em><em>b</em> + 2</sup>"],
    ["xy + z", "<em>x</em><em>y</em> + <em>z</em>"],
    ["\\alpha+\\beta=\\Gamma", "<em>α</em> + <em>β</em> = <em>Γ</em>"],
    ["x<y", "<em>x</em> &lt; <em>y</em>"],
    ["\\text{hello <world> & tax}", "hello &lt;world&gt; &amp; tax"],
    ["\\sin x", "sin <em>x</em>"],
    ["\\mathbf{xy}", "<strong>x</strong><strong>y</strong>"],
    ["1.23", "1.23"],
    ["", ""]
  ])(`renders default HTML math %s (retained=${retained})`, async (tex, expected) => {
    for (const display of [false, true]) expect(await render(tex, retained, display)).toMatchObject({text: `<p><span class="math ${display ? "display" : "inline"}">${expected}</span></p>\n`, diagnostics: []});
  });
  it.each(["\\frac{a}{b}", "\\sqrt{x}", "\\constructor", "\\toString", "\\unknown{<script>&}", "x^", "{x"])(`preserves unsupported math as escaped TeX with a warning (retained=${retained}): %s`, async tex => {
    for (const display of [false, true]) {
      const delimiter = display ? "$$" : "$";
      expect(await render(tex, retained, display)).toMatchObject({text: `<p><span class="math ${display ? "display" : "inline"}">${delimiter}${tex.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}${delimiter}</span></p>\n`, diagnostics: [expect.objectContaining({code: "W_PRESENTATION_LOSS"})]});
    }
  });
  it(`honors ASCII output, warning failures and resource limits (retained=${retained})`, async () => {
    expect(await render("\\alpha", retained, false, {ascii: true})).toMatchObject({text: '<p><span class="math inline"><em>&#945;</em></span></p>\n'});
    await expect(render("\\sqrt{x}", retained, false, {failIfWarnings: true})).rejects.toMatchObject({code: "E_WARNINGS"});
    await expect(render("{".repeat(40) + "x" + "}".repeat(40), retained, false, {}, {limits: {depth: 20}})).rejects.toMatchObject({code: "E_LIMIT"});
    await expect(render("x^2", retained, false, {}, {limits: {outputBytes: 20}})).rejects.toMatchObject({code: "E_LIMIT"});
  });
}
it("renders Math through writeDocument and the public command", async () => {
  const expected = '<p><span class="math inline"><em>x</em><sup>2</sup></span></p>\n';
  expect(await writeDocument({blocks: [{t: "Para", c: [{t: "Math", c: ["InlineMath", "x^2"]}]}], metadata: {}, resources: []}, {to: "html"}, {})).toMatchObject({text: expected});
  let text = "";
  const result = await createPandocCommand().execute({command: "pandoc", args: ["-fjson", "-thtml"], cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {yield new TextEncoder().encode(json("x^2"));})(), stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}}, stderr: {async write() {}}
  });
  expect(result.exitCode).toBe(0); expect(text).toBe(expected);
});
