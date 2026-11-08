import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {BackedJson} from "./backed-json.js";
import {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import {readRetainedRtf} from "./retained-rtf-reader.js";
import {readDocument} from "./index.js";
const bytes = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0));
async function compare(source: string) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {yield: async () => {}});
  const owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal}, storage = new PagedStorage(owner, 1), target = new PagedStorage(owner, 1);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole file reads forbidden"));
  let output = "", actualError: unknown, retained: Awaited<ReturnType<typeof readRetainedRtf>> | undefined;
  try {
    try {
      const syntax = await RetainedRtfSyntax.acquire({bytes: bytes(source)}, context, {fs, directory: "/", cacheBytes: 16384});
      const result = retained = await readRetainedRtf(syntax, storage, context), tree = new BackedJson(target, units => context.cooperate(units));
      await result.ast.write(result.blocks, tree);
      for await (const part of tree.chunks()) output += new TextDecoder().decode(part);
    } catch (error) {actualError = error;}
    const expected = await readDocument({bytes: bytes(source)}, {from: "rtf"}, {yield: async () => {}}).catch(error => error);
    if (expected instanceof Error) {
      const error = expected as Error & {code: string; location: string};
      expect(actualError).toMatchObject({message: error.message, code: error.code, location: error.location});
    } else {
      if (actualError) throw actualError;
      const actual = await readDocument({bytes: new TextEncoder().encode('{"pandoc-api-version":[1,23,1,2],"meta":{},"blocks":' + output + '}')}, {from: "json"}, {});
      expect(actual.blocks).toEqual(expected.blocks);
      for (const resource of expected.resources ?? []) {
        const source = await retained!.resource(resource.id); expect(source).toBeDefined();
        const chunks: Uint8Array[] = [];
        for await (const chunk of source!.chunks()) {expect(chunk.length).toBeLessThanOrEqual(16384); chunks.push(chunk);}
        expect(Uint8Array.from(chunks.flatMap(chunk => [...chunk]))).toEqual(resource.bytes);
      }
    }
  } finally {await target.close(); await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each([
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
])("matches the existing reader case %#", compare);
it("walks deeply nested groups through caller-backed continuations", async () => {
  await compare("{\\rtf1 " + "{\\b ".repeat(512) + "x" + "}".repeat(513));
});
it.each([
  String.raw`{\rtf1\cellx}`, String.raw`{\rtf1\cellx-2147483648}`, String.raw`{\rtf1\cell}`, String.raw`{\rtf1\row}`,
  String.raw`{\rtf1 text\trowd}`, String.raw`{\rtf1\fs0 X}`, String.raw`{\rtf1\b2 X}`, String.raw`{\rtf1\f9 X}`,
  String.raw`{\rtf1{\stylesheet{\s1\sbasedon2\b A;}{\s2\sbasedon1\i B;}}\s1 X}`,
  String.raw`{\rtf1{\field{\*\fldinst HYPERLINK "a"}{\fldrslt X\par}}}`,
  String.raw`{\rtf1{\field{\*\fldinst HYPERLINK "a"}{\fldrslt X}{\fldrslt Y}}}`,
  String.raw`{\rtf1\trowd\cellx100 A{\footnote note}\cell\row}`,
  String.raw`{\rtf1{\pn\pndec{\pntxtb (}{\pntxta )}}one\par two}`,
  String.raw`{\rtf1{\pn\pnlvlblt{\pntxta\uc0\u8226}}one}`,
  String.raw`{\rtf1{\pict\pngblip\jpegblip 89504e470d0a1a0a}}`, String.raw`{\rtf1{\pict\pngblip\bin1 x}}`
])("preserves control and scope boundary case %#", compare);
it("retains nested fields without a recursive continuation chain", async () => {
  await compare(String.raw`{\rtf1 ` + String.raw`{\field{\*\fldinst HYPERLINK "x"}{\fldrslt `.repeat(64) + "label" + "}}".repeat(64) + "}");
});
it("retains binary pictures across storage pages with stable resource IDs", async () => {
  const picture = "\x89PNG\r\n\x1a\n" + "x".repeat(65529);
  await compare(String.raw`{\rtf1{\pict\pngblip\bin65537 ` + picture + String.raw`}{\footnote{\pict\jpegblip ffd8}}}`);
});
it.each(["cancel", "storage"])("cleans up caller storage after semantic %s failure", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController();
  const context = new ExecutionContext("convert", {signal: controller.signal});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: controller.signal}, 1);
  try {
    const syntax = await RetainedRtfSyntax.acquire({bytes: bytes(String.raw`{\rtf1 ` + "{\\b x}".repeat(256) + "}")}, context, {fs, directory: "/", cacheBytes: 16384});
    let calls = 0;
    if (mode === "cancel") {
      const cooperate = context.cooperate.bind(context);
      vi.spyOn(context, "cooperate").mockImplementation(async units => {if (++calls === 64) controller.abort(); await cooperate(units);});
    } else vi.spyOn(storage, "append").mockRejectedValue(new Error("Semantic storage failed"));
    await expect(readRetainedRtf(syntax, storage, context)).rejects.toMatchObject(mode === "cancel" ? {code: "E_CANCELLED"} : {message: "Semantic storage failed"});
  } finally {await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
