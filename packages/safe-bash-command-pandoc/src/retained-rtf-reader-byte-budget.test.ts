import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput} from "./engine.js";
import {ExecutionContext} from "./execution.js";

const fixtures = [
  String.raw`{\rtf1}`, String.raw`{\rtf1\ansi A{\b B{\i C}D}E\par F}`,
  String.raw`{\rtf1 \\\{\}\'e9\~\_\-}`,
  String.raw`{\rtf1 A{\*\generator\b {hidden}\bin4 {}\\}B}`,
  String.raw`{\rtf1\uc2\u945\'3f\{X}`,
  String.raw`{\rtf1\u-10179?{\uc0\u-8704}}`,
  String.raw`{\rtf1\ansicpg65001 \'f0\'9f\'98\'80{\b bold}}`,
  String.raw`{\rtf1\deff1{\fonttbl{\f1\cpg65001 Serif;}}\'c3\'a9}`,
  String.raw`{\rtf1{\fonttbl\f0 Arial;\f1 Serif;}{\colortbl;\red255;}{\stylesheet{\s1\b B;}{\s2\sbasedon1\i I;}}\s2 title\par\plain\f1\cf1 end}`,
  String.raw`{\rtf1\trowd\cellx100\cellx200\intbl A\par B\cell C\cell\row\pard after}`,
  String.raw`{\rtf1{\*\listtable{\list{\listlevel\levelstartat3}{\listlevel\levelnfc23}\listid7}}{\*\listoverridetable{\listoverride\listid7\listoverridecount0\ls2}}\ls2 one\par{\ilvl1 sub\par}two\par\pard after}`,
  String.raw`{\rtf1 Before {\field{\*\fldinst HYPERLINK "https://example.test/a"}{\fldrslt{\b label}}} after}`,
  String.raw`{\rtf1{\field{\*\fldinst HYPERLINK \\l "bookmark"}{\fldrslt local}}}`,
  String.raw`{\rtf1{\field{\*\fldinst HYPERLINK "a"}{\fldrslt{\field{\*\fldinst HYPERLINK "b"}{\fldrslt nested}}}}}`,
  String.raw`{\rtf1 Body\chftn{\footnote\chftn note\par second} end}`,
  String.raw`{\rtf1{\fonttbl{\f0 Parent;}}\f0 Body{\footnote{\fonttbl{\f1 Local;}}\f1 note} end}`,
  String.raw`{\rtf1{\field{\*\fldinst HYPERLINK "a"}{\fldrslt label{\footnote note}}}}`,
  String.raw`{\rtf1\pard{\pntext 5.\tab}{\*\pn\pnlvlbody\pndec\pnstart5{\pntxta .}}one\par{\pntext 6.\tab}{\*\pn\pnlvlbody\pndec\pnstart5{\pntxta .}}two\par\pard after}`,
  String.raw`{\rtf1{\pict\pngblip 89504e470d0a1a0a}}`,
  String.raw`{\rtf1{\shppict{\pict\jpegblip ffd8}}}`,
  String.raw`{\rtf1\u-10179?X}`, String.raw`{\rtf1{\object hidden}}`, String.raw`{\rtf1{\*\unknown hidden}}`,
  String.raw`{\rtf1{\field{\*\fldinst INCLUDETEXT "secret"}{\fldrslt visible}}}`,
  String.raw`{\rtf1{\footnote{\footnote nested}}}`, String.raw`{\rtf1{\footnote\trowd\cellx100}}`,
  String.raw`{\rtf1{\footnote{\fonttbl{\f1 Local;}}note}\f1 outer}`,
  String.raw`{\rtf1{\listtext x}body}`, String.raw`{\rtf1{\pn\pndec{\pntxta unsupported}}x}`,
  String.raw`{\rtf1{\pict\pngblip 895}}`
];

const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AIAAggCBw24l4AAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
fixtures.push("{\\rtf1{\\pict\\pngblip " + [...png].map(byte => byte.toString(16).padStart(2, "0")).join("") + "}}", "{\\rtf1{\\pict\\pngblip\\bin" + png.length + " " + String.fromCharCode(...png) + "}}");
fixtures.push("{\\rtf1 " + "x".repeat(17000) + "}", "{\\rtf1\\ansicpg65001 " + String.fromCharCode(...new TextEncoder().encode("😀".repeat(5000))) + "}");
it.each(fixtures.flatMap((source, index) => (index === 1 ? ["json", "plain", "html5", "rst", "commonmark", "gfm", "latex", "rtf", "odt"] : index >= 30 ? ["plain", "rtf", "odt"] : ["json"]).map(to => ({source, index, to}))))("retains RTF reader byte thresholds for fixture $index to $to", async ({source, index, to}) => {
  const bytes = Uint8Array.from(source, char => char.charCodeAt(0));
  const input = {source: "/input.rtf", chunks: [bytes.subarray(0, 11), bytes.subarray(11)]};
  const options = {from: "rtf", to, lossy: true}, ceiling = 2000000;
  const boundaries = new Set<number>([0, 1, ceiling]), original = ExecutionContext.prototype.charge;
  const sink = (bytes: number[]) => ({async write(chunk: Uint8Array) {bytes.push(...chunk);}, async close() {}, async abort() {}});
  const trace = vi.spyOn(ExecutionContext.prototype, "charge").mockImplementation(function(this: ExecutionContext, ...args) {
    const result = original.apply(this, args);
    if (["retainedBytes", "binaryBytes"].includes(args[0])) {const used = ceiling - this.remaining("retainedBytes"); boundaries.add(used); boundaries.add(used - 1);}
    return result;
  });
  try {
    const baseline = await convert([input], options, {limits: {retainedBytes: ceiling}, output: sink([])}).catch(error => error);
    if (index < 18 || index >= 30) expect(baseline).not.toBeInstanceOf(Error);
  } finally {trace.mockRestore();}
  const values = [...boundaries].filter(value => value >= 0).sort((a,b) => a-b);
  for (const retainedBytes of values.filter((_, index) => index % Math.ceil(values.length / 64) === 0 || index >= values.length - 24)) {
    const expectedBytes: number[] = [], actualBytes: number[] = [], fs = new MemoryFileSystem();
    const expected = await convert([input], options, {limits: {retainedBytes}, output: sink(expectedBytes)}).catch(error => error);
    const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Whole input forbidden"));
    try {
      const actual = await convertToOutput([input], options, {limits: {retainedBytes}, workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: sink(actualBytes)}).catch(error => error);
      expect(acquire, String(retainedBytes)).not.toHaveBeenCalled();
      if (expected instanceof Error) expect(actual, String(retainedBytes)).toMatchObject({code: (expected as {code?: string}).code, message: expected.message, location: (expected as {location?: string}).location});
      else {expect(actual, String(retainedBytes)).not.toBeInstanceOf(Error); expect(actual.diagnostics).toEqual(expected.diagnostics);}
      expect(actualBytes, String(retainedBytes)).toEqual(expectedBytes);
    } finally {acquire.mockRestore();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
