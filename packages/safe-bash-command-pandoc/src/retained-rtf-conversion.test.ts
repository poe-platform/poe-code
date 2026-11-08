import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";
const encoder = new TextEncoder();
it.each([
  String.raw`{\rtf1\ansi Hello {\b bold} world\par second\line line}`,
  String.raw`{\rtf1\ansi\uc1 \u-10179?\u-8704? \i italic\i0\par}`,
  String.raw`{\rtf1{\fonttbl{\f0 Arial;}}{\colortbl;\red255\green0\blue0;}\deff0\cf1\fs25 Text\par}`,
  String.raw`{\rtf1\trowd\cellx100\cellx200\intbl A\cell B\cell\row}`
])("retains RTF semantic state without acquiring a complete input: %s", async source => {
  const input = {bytes: encoder.encode(source)}, options = {from: "rtf", to: "plain"};
  const expected = await convert([input], options, {}), fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
    expect(expected).toMatchObject({text}); expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

const syntaxCases = [
  "{\\rtf1\\ansi A{\\b B{\\i C}D}E\\par F}",
  "{\\rtf1 \\\\\\{\\}\\'e9\\~\\_\\-}",
  "{\\rtf1 A{\\*\\generator\\b {hidden}\\bin4 {}\\\\}B}",
  "{\\rtf1\\uc1\\u945?X}",
  "{\\rtf1\\uc2\\u945\\'3f\\{X}",
  "{\\rtf1\\uc0\\u945{\\uc2\\u946??}\\u947X}",
  "{\\rtf1\\u-10179?\\u-8704?}",
  "{\\rtf1\\u945?{\\b X}Y}",
  "{\\rtf1\\uc2\\u945?{X}Y}",
  "{\\rtf1\\ansi\\ansicpg1252 \\'e9{\\ansicpg65001 \\'c3\\'a9}\\'e9}",
  "{\\rtf1\\ansicpg65001 \\'f0\\'9f\\'98\\'80}",
  "{\\rtf1\\ansi{\\fonttbl{\\f0\\fnil Arial;}{\\f1\\fnil\\fcharset0 Serif;}}{\\colortbl;\\red255\\green0\\blue0;}{\\stylesheet{\\s1\\b Heading;}}\\s1 Title\\par\\pard\\plain\\f1\\cf1\\'e9}",
  "{\\rtf1 Before {\\field{\\*\\fldinst HYPERLINK \"https://example.test/a\"}{\\fldrslt label}} after}",
  "{\\rtf1{\\field{\\*\\fldinst INCLUDETEXT \"secret\"}{\\fldrslt visible}}}",
  "{\\rtf1\\trowd\\cellx1000\\cellx2000\\intbl A\\cell B\\cell\\row\\pard after}",
  "{\\rtf1{\\*\\listtable{\\list{\\listlevel\\levelnfc0\\levelstartat3{\\leveltext\\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid7}}{\\*\\listoverridetable{\\listoverride\\listid7\\listoverridecount0\\ls2}}\\pard\\ls2\\ilvl0 one\\par two\\par\\pard after}",
  "{\\rtf1\\ansicpg65001\\deff0{\\fonttbl\\f0\\fnil\\fcharset0 Arial;\\f1\\fnil\\fcharset1 Serif;}\\'c3\\'a9}",
  "{\\rtf1\\ansi\\deff1{\\fonttbl{\\f1\\fnil\\cpg65001 Serif;}}\\'c3\\'a9}",
  "{\\rtf1\\u-10179?{\\uc0\\u-8704}}",
  "{\\rtf1{\\field{\\*\\fldinst HYPERLINK \\\\l \"bookmark\"}{\\fldrslt{\\b label}}}}",
  "{\\rtf1\\pard{\\pntext 5.\\tab}{\\*\\pn\\pnlvlbody\\pndec\\pnstart5{\\pntxta .}}one\\par{\\pntext 6.\\tab}{\\*\\pn\\pnlvlbody\\pndec\\pnstart5{\\pntxta .}}two\\par\\pard after}",
  "{\\rtf1{\\*\\listtable{\\list{\\listlevel\\levelnfc0\\levelstartat1{\\leveltext\\'02\\'00);}}\\listid7}}{\\*\\listoverridetable{\\listoverride\\listid7\\listoverridecount1{\\lfolevel\\listoverridestartat\\levelstartat9}\\ls2}}\\pard\\ls2 one\\par two}",
  "{\\rtf1{\\*\\listtable{\\list{\\listlevel\\levelnfc0}{\\listlevel\\levelnfc23}\\listid7}}{\\*\\listoverridetable{\\listoverride\\listid7\\listoverridecount0\\ls2}}\\ls2 one\\par{\\ilvl1 sub\\par}two\\par\\pard\\trowd\\cellx100\\intbl A\\cell\\row\\trowd\\cellx100\\intbl B\\cell\\row}",
  "{\\rtf1{\\*\\shppict{\\pict\\pngblip 89504e470d0a1a0a}}}",
  "{\\rtf1{\\*\\unknown visible}}",
  "{\\rtf1{\\*\\header visible}}",
  "{\\rtf1{\\field hidden{\\*\\fldinst HYPERLINK \"https://example.test\"}{\\fldrslt label}}}",
  "{\\rtf1\\outlinelevel0 Title\\par\\pard{\\qc\\li720\\ri360\\fi-240 centered\\par}normal}",
  "{\\rtf1 A{\\footnote\\pard{\\b note}\\par second}B}",
  "{\\rtf1\\ansicpg1251 x}",
  "{\\rtf1\\ansicpg932 x}",
  "{\\rtf1\\ansicpg28591 x}",
  "{\\rtf1\\mac x}",
  "{\\rtf1{\\fonttbl{\\f0\\fcharset204 Cyrillic;}}x}",
  "{\\rtf1 A{\\pict\\pngblip\\picw1\\pich1 89504e470d0a1a0a}B}",
  "{\\rtf1\\'z0}",
  "{\\rtf1\\'0}",
  "{\\rtf1{\\*\\ignored\\bin10 x}}",
  "{\\rtf1\\bin-1 x}",
  "{\\rtf1",
  "{\\rtf2 text}",
  "{\\rtf1\\ansicpg437 text}",
  "{\\rtf1\\ansicpg99999 text}",
  "{\\rtf1\\u-10179?}",
  "{\\rtf1\\u-8704?}",
  "{\\rtf1\\uc-1 x}",
  "{\\rtf1\\unknown visible}",
  "{\\rtf1{\\object{\\objdata 00}{\\result visible}}}",
  "{\\rtf1{\\*\\object hidden}}",
  "{\\rtf1{\\pict\\wmetafile8 00}}",
  "{\\rtf1{\\pict\\pngblip 0}}",
  "{\\rtf1\\trowd\\cellx1000\\intbl x\\row}",
  "{\\rtf1{\\pict\\pngblip 89504e470d0a1a0a}}",
  "{\\rtf1 text}",
  "{\\rtf1\\trowd\\cellx1000\\pard\\intbl first\\par second\\cell\\row\\pard after}",
  "{\\rtf1\\deff0{\\fonttbl{\\f0\\fnil Serif;}}text}",
  "{\\rtf1{\\stylesheet{\\s0\\b Base;}{\\s1\\sbasedon0\\i\\outlinelevel1 Heading;}}\\s1 title}",
  "{\\rtf1{\\stylesheet{\\s1\\sbasedon2 A;}{\\s2\\sbasedon1 B;}}\\s1 title}",
  "{\\rtf1\\ansicpg65001\\'c3}",
  "{\\rtf1\\ansicpg65001\\'ff}",
  "{\\rtf1\\uc3\\u945\\tab\\~\\bin4 {}\\\\X}",
  "{\\rtf1\\uc0\\u945?}",
  "{\\rtf1\\u32768?}",
  "{\\rtf1\\uc2147483648 x}",
  "{\\rtf1\\u-?}",
  "{\\rtf1\\bin x}",
  "{\\rtf1\\'gg}",
  "{\\rtf1}extra",
  "{\\rtf1\\trowd\\clmgf\\cellx1000\\intbl visible\\cell\\row}",
  "{\\rtf1{\\pict\\dibitmap0 0000}}",
  "{\\rtf1{\\pict\\pngblip\\picw100000\\pich100000 89504e470d0a1a0a}}",
  "{\\rtf1{\\fonttbl{\\f0\\fnil{\\*\\fontemb\\bin1 x}Serif;}}visible}",
  "{\\rtf1{\\fonttbl{\\f0\\unsupported Serif;}}visible}",
  "{\\rtf1{\\stylesheet{\\s1{\\*\\unknown visible}Style;}}\\s1 body}",
  "{\\rtf1{\\*\\listtable{\\list{\\listlevel\\levelnfc0\\unknown visible}\\listid7}}body}",
  "{\\rtf1{\\*\\listoverridetable{\\listoverride\\listid7\\listoverridecount0\\unknown visible\\ls2}}body}",
  "{\\rtf1\\b hello}",
  "{\\rtf1\\unknown text}"
];

it.each(syntaxCases.flatMap(source => ["json", "plain"].map(to => ({source, to}))))("preserves RTF conversion or diagnostics: $to $source", async ({source, to}) => {
  const input = {bytes: Uint8Array.from(source, char => char.charCodeAt(0))}, options = {from: "rtf", to};
  const expected = await convert([input], options, {}).catch(error => error);
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const actual = await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error);
    if (expected instanceof Error) {const failure = expected as Error & {code: string; location?: string}; expect(actual).toMatchObject({code: failure.code, message: failure.message, location: failure.location});}
    else {expect(actual).not.toBeInstanceOf(Error); expect(expected).toMatchObject({text, diagnostics: actual.diagnostics});}
    expect(acquire).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});

it.each(["json", "html", "plain", "commonmark", "gfm", "rst", "latex", "rtf", "odt"])("preserves RTF writer parity and picture resources: %s", async to => {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
  const input = {bytes: encoder.encode("{\\rtf1 Before {\\pict\\pngblip " + Array.from(png, byte => byte.toString(16).padStart(2, "0")).join("") + "} after}")};
  const options = {from: "rtf", to};
  const expected = await convert([input], options, {}).catch(error => error), fs = new MemoryFileSystem(), parts: Uint8Array[] = [];
  const read = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
  try {
    const actual = await convertToOutput([input], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {parts.push(bytes.slice());}, async close() {}, async abort() {}}}).catch(error => error);
    if (to !== "json") expect(expected).not.toBeInstanceOf(Error);
    if (expected instanceof Error) expect(actual).toMatchObject({message: expected.message});
    else {
      expect(actual).not.toBeInstanceOf(Error);
      const bytes = Uint8Array.from(parts.flatMap(part => Array.from(part)));
      expect(bytes).toEqual(expected.kind === "text" ? encoder.encode(expected.text) : expected.bytes);
    }
    expect(acquire).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  } finally {acquire.mockRestore();}
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["success", "source-error", "cancel", "sink-error"])("bounds RTF source and semantic storage with reused chunks: %s", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), open = fs.open.bind(fs); let writes = 0, live = 0, peak = 0, finalized = 0, pending = 0, output = 0;
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file forbidden"));
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await open(...args), write = handle.write.bind(handle), close = handle.close.bind(handle); peak = Math.max(peak, ++live);
    vi.spyOn(handle, "write").mockImplementation(async (...args) => {expect(args[0].length).toBeLessThanOrEqual(16384); writes++; return write(...args);});
    vi.spyOn(handle, "close").mockImplementation(async (...args) => {try {return await close(...args);} finally {live--;}}); return handle;
  });
  const chunks = async function* () {
    try {yield encoder.encode("{\\rtf1 "); const reused = new Uint8Array(8192);
      for (let i = 0; i < 16; i++) {reused.fill(97 + i % 2); yield reused; if (i === 8 && mode === "source-error") throw new Error("Producer failed"); if (i === 8 && mode === "cancel") controller.abort();}
      yield encoder.encode("}");
    } finally {finalized++;}
  };
  const close = vi.fn(async () => {}), abort = vi.fn(async () => {});
  const operation = convertToOutput([{chunks: chunks()}], {from: "rtf", to: "plain"}, {signal: controller.signal, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
    async write(bytes) {expect(++pending).toBe(1); expect(bytes.length).toBeLessThanOrEqual(16384); if (mode === "sink-error") throw new Error("Sink failed"); output += bytes.length; await Promise.resolve(); pending--;}, close, abort
  }});
  if (mode === "success") {await operation; expect(output).toBeGreaterThanOrEqual(131072); expect(close).toHaveBeenCalledOnce();}
  else {await expect(operation).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"}); expect(close).not.toHaveBeenCalled();}
  expect(abort).toHaveBeenCalledTimes(mode === "sink-error" ? 1 : 0); expect(writes).toBeGreaterThan(0); expect(peak).toBeLessThanOrEqual(6); expect(live).toBe(0); expect(finalized).toBe(1); expect(await fs.readdir("/")).toEqual([]);
});
it.each([String.raw`{\rtf1\row}`, String.raw`{\rtf1\u?}`, String.raw`{\rtf1`, String.raw`{\rtf1\ansicpg99 x}`])("preserves named-source diagnostics: %s", async source => {
  const input = {bytes: encoder.encode(source), base: "/docs", source: "/docs/source.rtf"};
  const expected = await convert([input], {from: "rtf", to: "plain"}, {}).catch(error => error);
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([input], {from: "rtf", to: "plain"}, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: expected.code, message: expected.message, location: expected.location});
  expect(await fs.readdir("/")).toEqual([]);
});
it.each(["json", "lua"] as const)("retains RTF metadata/filter ordering with a real %s protocol", async kind => {
  const input = {bytes: encoder.encode(String.raw`{\rtf1\outlinelevel0 before\par text}`)};
  const fs = new MemoryFileSystem();
  const {createLuaFilterCapability} = await import("./lua-filters.js");
  const make = () => kind === "lua" ? createLuaFilterCapability({readStream: async function* () {yield encoder.encode("function Str(el) el.text=string.upper(el.text); return el end");}}) : {
    async apply(document: import("./types.js").Document) {return document;},
    async applyJsonStream(input: {stdin: AsyncIterable<Uint8Array>; stdout: {write(bytes: Uint8Array): Promise<void>}}) {for await (const chunk of input.stdin) await input.stdout.write(chunk);}
  };
  const options = {from: "rtf", to: "json", metadataJson: [{title: "option"}], shiftHeadingLevelBy: 1, filters: [{kind, path: "/filter"}]};
  const expected = await convert([input], options, {filters: make()});
  let text = ""; const filters = make(); vi.spyOn(filters, "apply").mockRejectedValue(new Error("Resident filter forbidden"));
  await convertToOutput([input], options, {filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}});
  expect(expected).toMatchObject({text}); expect(await fs.readdir("/")).toEqual([]);
});
it.each(["identity", "delete", "replace"])("preserves embedded RTF resources through Lua image %s", async mode => {
  const png = "89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b550000000d494441547801010200fdff008000820081c36e25e00000000049454e44ae426082";
  const input = {bytes: encoder.encode("{\\rtf1 Before {\\pict\\pngblip " + png + "} after}")};
  const {createLuaFilterCapability} = await import("./lua-filters.js");
  const script = mode === "delete" ? "function Image(el) return {} end" : mode === "replace" ? "function Image(el) return pandoc.Image(el.caption, el.src) end" : "function Image(el) return el end";
  const make = () => createLuaFilterCapability({readStream: async function* () {yield encoder.encode(script);}});
  const options = {from: "rtf", to: "rtf", filters: [{kind: "lua" as const, path: "/filter"}]};
  const expected = await convert([input], options, {filters: make()}).catch(error => error);
  const fs = new MemoryFileSystem(); let text = "";
  const actual = await convertToOutput([input], options, {filters: make(), workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}}}).catch(error => error);
  if (mode !== "delete") expect(expected).not.toBeInstanceOf(Error);
  if (expected instanceof Error) expect(actual).toMatchObject({message: expected.message});
  else {expect(actual).not.toBeInstanceOf(Error); expect(expected).toMatchObject({text});}
  expect(await fs.readdir("/")).toEqual([]);
});
it("preserves JSON-filter rejection of relative RTF image targets before invocation", async () => {
  const input = {bytes: encoder.encode(String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}}`)};
  const filters = {apply: vi.fn(async (document: import("./types.js").Document) => document), applyJsonStream: vi.fn(async () => {})};
  const options = {from: "rtf", to: "plain", filters: [{kind: "json" as const, path: "/filter"}]};
  const fs = new MemoryFileSystem();
  await expect(convertToOutput([input], options, {filters, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {async write() {}, async close() {}, async abort() {}}})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE", message: "JSON filters cannot preserve relative image source directories"});
  expect(filters.applyJsonStream).not.toHaveBeenCalled(); expect(filters.apply).not.toHaveBeenCalled();
  expect(await fs.readdir("/")).toEqual([]);
});

it.each([...syntaxCases,
  String.raw`{\rtf1{\fonttbl{\f0  First  Second; trailing words}}\f0 body}`,
  String.raw`{\rtf1{\fonttbl{\f0 Unterminated name}}\f0 body}`,
  String.raw`{\rtf1{\fonttbl{\f0\cpg65001 Font; invalid \'ff}}\f0 body}`
])("retains RTF reference limits and source diagnostics: %s", async source => {
  const bytes = encoder.encode(source), input = {chunks: [bytes.subarray(0, 3), bytes.subarray(3)], source: "/input.rtf"};
  const options = {from: "rtf", to: "json"};
  for (const references of [...Array.from({length: 129}, (_, index) => index), 256]) {
    const expected = await convert([input], options, {limits: {references}}).catch(error => error);
    const fs = new MemoryFileSystem(); let text = "";
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {references}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
        async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
      }}).catch(error => error);
      expect(acquire.mock.calls.length, `references=${references}`).toBe(0);
      if (expected instanceof Error) expect(actual, `references=${references}`).toMatchObject({code: (expected as Error & {code: string}).code, message: expected.message, location: (expected as Error & {location?: string}).location});
      else {expect(actual, `references=${references}`).not.toBeInstanceOf(Error); expect(text).toBe(expected.text);}
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
