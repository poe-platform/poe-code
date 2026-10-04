import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

const samples = [
  "== Heading ==\n\nParagraph with ''emphasis'', '''strong''', <code>a b</code> and <s>gone</s>.\ncontinued\n\n----\n",
  "* one\n** two\n# three\n## four\n",
  "<syntaxhighlight lang=\"js\">\nconst x = 1;\n\n</syntaxhighlight>\n<pre>\nraw\n</pre>\n",
  "{|\n! A !! B\n|-\n| one || two\n|-\n| style=x | three || [[target|label]]\n|}\n",
  "[[File:picture.png|thumb|alt text]] [[page|''nested'']] [https://example.com label] [mailto:a@b]",
  "{|\n! first\n|-\n! second\n|-\n| body\n|-\n! later\n|}\n",
  ("é".repeat(4095) + "😀").repeat(3),
  "A".repeat(20000) + "\n" + "B".repeat(20000),
];
it.each(samples.map((text, index) => ({text, index})))("retains MediaWiki source and AST $index", async ({text}) => {
  const input = {bytes: new TextEncoder().encode(text)};
  const options = {from: "mediawiki", to: "json"};
  const expected = await convert([input], options, {});
  const fs = new MemoryFileSystem(); let actual = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
  try {
    await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {actual += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
    }});
    expect(acquire).not.toHaveBeenCalled();
    expect(actual).toBe(expected.kind === "text" ? expected.text : undefined);
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([
  "[[File:|caption]]", "[[File:]]", "[http://]", "[mailto:]", "[https://x ]", "[https://x  ]",
  "= a =", "== a ===", "=== a ==", "=====", "== ==", "<pre>\nunclosed\n", "{|\n| unclosed",
  "[[x|[http://x]]", "[[one|two|three]]", "[[File:x|thumb|a|b]]", "[[x|[http://x label]]]", "''a '''b''' c''", "<s></s>",
  " a\r\nb\rc\n\n\t d ", "<syntaxhighlight language=x lang='y\">\ncode\n</pre>",
].map((text, index) => ({text, index})))("preserves MediaWiki syntax edge $index", async ({text}) => {
  const input = {bytes: new TextEncoder().encode(text)}, options = {from: "mediawiki", to: "json"};
  const expected = await convert([input], options, {});
  const fs = new MemoryFileSystem(); let actual = "";
  await convertToOutput([input], options, {workingFiles: {fs, directory: "/"}, output: {async write(bytes) {actual += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(actual, text).toBe(expected.kind === "text" ? expected.text : undefined);
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"].flatMap(to => ["single", "joined", "fileScope"].map(mode => ({to, joined: mode !== "single", fileScope: mode === "fileScope"}))))("preserves MediaWiki byte/reference quotas to $to joined=$joined scope=$fileScope", async ({to, joined, fileScope}) => {
  const input = {bytes: new TextEncoder().encode("== Title ==\n\n''body 😀'' [[target|link]]\n")}, options = {from: "mediawiki", to, lossy: true, fileScope};
  const inputs = joined ? [input, {bytes: new TextEncoder().encode("second"), source: "second.wiki"}, {bytes: new Uint8Array()}] : [input];
  const ceiling = 1000000, boundaries = new Set<number>(), original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  for (const budget of ["retainedBytes", "references"] as const) {
    boundaries.clear(); boundaries.add(0); boundaries.add(ceiling);
    const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {const result = original.apply(this, args); if (args[0] === budget) {const used = ceiling - this.remaining(budget); boundaries.add(used); boundaries.add(used - 1);} return result;});
    try {await convert(inputs, options, {limits: {[budget]: ceiling}, output: sink([])});} finally {trace.mockRestore();}
    const values = [...boundaries];
    for (const limit of values.filter((_, i) => i % Math.ceil(values.length / 24) === 0 || i >= values.length - 4)) {
      if (limit < 0) continue;
      const fs = new MemoryFileSystem(), expectedBytes: number[] = [], actualBytes: number[] = [], limits = {[budget]: limit};
      const expected = await convert(inputs, options, {limits, output: sink(expectedBytes)}).catch(error => error);
      const actual = await convertToOutput(inputs, options, {limits, workingFiles: {fs, directory: "/"}, output: sink(actualBytes)}).catch(error => error);
      if (expected instanceof Error) expect(actual, `${budget}=${limit}`).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, `${budget}=${limit}`).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes).toEqual(expectedBytes); expect(await fs.readdir("/")).toEqual([]);
    }
  }
});



it.each(["nodes", "text", "depth", "attributes", "tableCells"] as const)("preserves MediaWiki %s failures and locations", async budget => {
  const input = {bytes: new TextEncoder().encode("== Heading ==\n\n{|\n! A !! B\n|-\n| a || b\n|}\n"), source: "document.wiki"};
  for (const limit of [0, 1, 8, 32, 64, 512]) for (const fileScope of [false, true]) for (const multiple of [false, true]) {
    const inputs = multiple ? [input, {...input, source: "second.wiki"}] : [input];
    const options = {from: "mediawiki", to: "json", fileScope}, limits = {[budget]: limit};
    const expected = await convert(inputs, options, {limits}).catch(error => error);
    const fs = new MemoryFileSystem(); let text = "";
    const actual = await convertToOutput(inputs, options, {limits, workingFiles: {fs, directory: "/"}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error);
    if (expected instanceof Error) expect(actual, `${budget}=${limit} scope=${fileScope}`).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
    else {expect(actual).not.toBeInstanceOf(Error); expect(text).toBe(expected.text);}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it.each(["source", "cancel", "sink"].flatMap(mode => [false, true].map(fileScope => ({mode, fileScope}))))("cleans MediaWiki storage after $mode failure scope=$fileScope", async ({mode, fileScope}) => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let returned = false, writes = 0;
  const input = {chunks: (async function* () {try {yield new TextEncoder().encode("body"); if (mode === "source") throw new Error("Source failed"); if (mode === "cancel") controller.abort();} finally {returned = true;}})()};
  await expect(convertToOutput(fileScope ? [{bytes: new TextEncoder().encode("first")}, input] : [input], {from: "mediawiki", to: "plain", fileScope}, {signal: controller.signal, workingFiles: {fs, directory: "/"}, output: {async write() {writes++; throw new Error("Sink failed");}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  expect(returned).toBe(true); expect(writes).toBe(mode === "sink" ? 1 : 0); expect(await fs.readdir("/")).toEqual([]);
});

it("matches mixed MediaWiki token and line boundaries", async () => {
  const tokens = ["a", " ", "\n", "=", "==", "''", "'''", "[[", "]]", "|", "!", "*", "#", "<code>", "</code>", "<s>", "</s>", "[http://x", "]", "😀", "{|", "|}", "|-", "<pre>", "</pre>", "\t"];
  let state = 1770;
  for (let sample = 0; sample < 120; sample++) {
    let text = "";
    for (let i = 0; i < 12; i++) {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; text += tokens[state % tokens.length];}
    const input = {bytes: new TextEncoder().encode(text)}, options = {from: "mediawiki", to: "json"};
    const expected = await convert([input], options, {}).catch(error => error);
    const fs = new MemoryFileSystem(); let output = "";
    const actual = await convertToOutput([input], options, {workingFiles: {fs, directory: "/"}, output: {async write(bytes) {output += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error);
    if (expected instanceof Error) expect(actual, text).toMatchObject({code: (expected as {code?: string}).code, message: expected.message});
    else {expect(actual, text).not.toBeInstanceOf(Error); expect(output, text).toBe(expected.text);}
    expect(await fs.readdir("/")).toEqual([]);
  }
});

it("retains joined MediaWiki operands without whole-source acquisition", async () => {
  const inputs = ["== First ==", "", "second\n", "[[page|third]]"].map((text, i) => ({bytes: new TextEncoder().encode(text), source: `part-${i}.wiki`}));
  const options = {from: "mediawiki", to: "json"};
  const expected = await convert(inputs, options, {});
  const fs = new MemoryFileSystem(); let actual = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
  try {
    await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {actual += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(acquire).not.toHaveBeenCalled();
    expect(actual).toBe(expected.kind === "text" ? expected.text : undefined);
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([false, true])("acquires later operands before MediaWiki reader failures scope=%s", async fileScope => {
  const fs = new MemoryFileSystem(); let pulled = false;
  const inputs = [{bytes: new TextEncoder().encode("== Heading ==")}, {chunks: (async function* () {pulled = true; throw new Error("Later source failed"); yield new Uint8Array();})()}];
  await expect(convertToOutput(inputs, {from: "mediawiki", to: "json", fileScope}, {limits: {nodes: 0}, workingFiles: {fs, directory: "/"}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: "E_IO", message: "Capability failed"});
  expect(pulled).toBe(true); expect(await fs.readdir("/")).toEqual([]);
});

it("preserves native quotas for two large joined operands", async () => {
  const inputs = Array.from({length: 2}, () => ({bytes: new TextEncoder().encode("x".repeat(60000))}));
  const options = {from: "mediawiki", to: "plain"}, limits = {retainedBytes: 64000000, text: 6000000, references: 10000, nodes: 1000, depth: 64};
  const expected = await convert(inputs, options, {limits});
  const fs = new MemoryFileSystem(); let text = "";
  await convertToOutput(inputs, options, {limits, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(text).toBe(expected.kind === "text" ? expected.text : undefined);
  expect(await fs.readdir("/")).toEqual([]);
});

it("retains file-scope MediaWiki operands as separate documents", async () => {
  const inputs = ["<pre>\nfirst", "second\n</pre>"].map(text => ({bytes: new TextEncoder().encode(text)}));
  const options = {from: "mediawiki", to: "json", fileScope: true};
  const expected = await convert(inputs, options, {}), fs = new MemoryFileSystem(); let actual = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole source forbidden"));
  try {
    await convertToOutput(inputs, options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {actual += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(acquire).not.toHaveBeenCalled(); expect(actual).toBe(expected.kind === "text" ? expected.text : undefined);
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
