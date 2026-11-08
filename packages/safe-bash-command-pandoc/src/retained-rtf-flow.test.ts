import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {BackedJson} from "./backed-json.js";
import {RetainedRtfSyntax} from "./retained-rtf-syntax.js";
import {RetainedRtfDefinitions} from "./retained-rtf-definitions.js";
import {RetainedRtfLists} from "./retained-rtf-lists.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
import {retainedRtfHyperlink} from "./retained-rtf-field.js";
import {RetainedRtfFlow} from "./retained-rtf-flow.js";
import {initialRtfState, type RtfState} from "./rtf-profile.js";
import {convert} from "./index.js";
import type {ConversionContext} from "./types.js";
async function compare(source: string, run: (flow: RetainedRtfFlow, state: RtfState, context: ExecutionContext) => Promise<void>, limits?: ConversionContext["limits"]) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {yield: async () => {}, limits: limits ?? {}});
  const owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal}, storage = new PagedStorage(owner, 1), output = new PagedStorage(owner, 1);
  try {
    const bytes = new TextEncoder().encode(source), syntax = await RetainedRtfSyntax.acquire({bytes}, context, {fs, directory: "/", cacheBytes: 16384});
    const definitions = new RetainedRtfDefinitions(syntax, storage, context), lists = new RetainedRtfLists(syntax, storage, context), state = initialRtfState();
    for await (const node of syntax.children(syntax.root)) if ((await syntax.token(node)).kind === "group") {await definitions.read(node, state); await lists.read(node);}
    const ast = new RetainedRtfAst(storage, units => context.cooperate(units)), flow = await RetainedRtfFlow.create(ast, definitions, lists, context);
    let json = "", actualError: unknown;
    try {
      await run(flow, state, context); await flow.finish(state);
      const tree = new BackedJson(output, units => context.cooperate(units)); await ast.write(flow.blocks, tree);
      for await (const bytes of tree.chunks()) json += new TextDecoder().decode(bytes);
    } catch (error) {actualError = error;}
    const expected = await convert([{bytes}], {from: "rtf", to: "json"}, {yield: async () => {}, limits: limits ?? {}}).catch(error => error);
    if (expected instanceof Error) {
      const error = expected as Error & {code: string; location: string};
      expect(actualError).toMatchObject({code: error.code, message: error.message, location: error.location});
    } else {
      if (actualError) throw actualError;
      if (expected.kind !== "text") throw new Error("Expected JSON text");
      expect(JSON.parse(json)).toEqual(JSON.parse(expected.text).blocks);
    }
  } finally {await output.close(); await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it("preserves paragraphs, whitespace, nested run styling and Unicode pairs", async () => {
  await compare(String.raw`{\rtf1  A{\b B{\i C}D}E  \par\u-10179?\u-8704?}`, async (flow, state) => {
    await flow.emit(" A"); await flow.flush(state);
    state.tags.add("Strong"); await flow.emit("B"); await flow.flush(state);
    state.tags.add("Emph"); await flow.emit("C"); await flow.flush(state);
    state.tags.delete("Emph"); await flow.emit("D"); await flow.flush(state);
    state.tags.clear(); await flow.emit("E  "); await flow.paragraph(state, true);
    await flow.unicode(0xd83d); await flow.unicode(0xde00);
  });
});
it("preserves retained fonts, colors, headings and paragraph layout", async () => {
  await compare(String.raw`{\rtf1{\fonttbl{\f1 Serif;}}{\colortbl;\red255;}\f1\cf1\fs24\qc\li40\outlinelevel1 Title}`, async (flow, state) => {
    state.font = 1; state.color = 1; state.size = 24; state.alignment = "center"; state.left = 40; state.heading = 2;
    await flow.emit("Title");
  });
});
it("retains nested list items and returns to ordinary paragraphs", async () => {
  await compare(String.raw`{\rtf1{\*\listtable{\list{\listlevel\levelstartat3}{\listlevel\levelnfc23}\listid7}}{\*\listoverridetable{\listoverride\listid7\listoverridecount0\ls2}}\ls2 one\par{\ilvl1 sub\par}two\par\pard after}`, async (flow, state) => {
    state.list = 2; await flow.emit("one"); await flow.paragraph(state, true);
    state.level = 1; await flow.emit("sub"); await flow.paragraph(state, true);
    state.level = 0; await flow.emit("two"); await flow.paragraph(state, true);
    state.list = undefined; await flow.emit("after");
  });
});
it("retains multiple table rows and paragraph boundaries within cells", async () => {
  await compare(String.raw`{\rtf1\trowd\cellx100\cellx200\intbl A\par B\cell C\cell\row\trowd\cellx100\cellx200\intbl D\cell E\cell\row\pard after}`, async (flow, state) => {
    for (const row of [["A", "B", "C"], ["D", undefined, "E"]]) {
      await flow.startRow(); flow.boundary(100); flow.boundary(200);
      await flow.emit(row[0]!);
      if (row[1]) {await flow.paragraph(state, true); await flow.emit(row[1]);}
      await flow.cell(state); await flow.emit(row[2]!); await flow.cell(state); await flow.row();
    }
    await flow.emit("after");
  });
});

it.each(["outside", "nonincreasing", "incomplete", "unfinished", "geometry"])("preserves %s table errors", async mode => {
  const sources: Record<string, string> = {
    outside: String.raw`{\rtf1\cellx100}`,
    nonincreasing: String.raw`{\rtf1\trowd\cellx100\cellx100}`,
    incomplete: String.raw`{\rtf1\trowd\cellx100\row}`,
    unfinished: String.raw`{\rtf1\trowd\cellx100}`,
    geometry: String.raw`{\rtf1\trowd\cellx100 A\cell\row\trowd\cellx100\cellx200 B\cell C\cell\row}`
  };
  await compare(sources[mode]!, async (flow, state) => {
    if (mode === "outside") {flow.boundary(100); return;}
    await flow.startRow(); flow.boundary(100);
    if (mode === "nonincreasing") flow.boundary(100);
    if (mode === "incomplete") await flow.row();
    if (mode === "geometry") {
      await flow.emit("A"); await flow.cell(state); await flow.row();
      await flow.startRow(); flow.boundary(100); flow.boundary(200);
      await flow.emit("B"); await flow.cell(state); await flow.emit("C"); await flow.cell(state); await flow.row();
    }
  });
});
it.each(["tableColumns", "tableCells", "tableRows"] as const)("preserves the %s limit", async key => {
  await compare(String.raw`{\rtf1\trowd\cellx100\cellx200 A\cell B\cell\row\trowd\cellx100\cellx200 C\cell D\cell\row}`, async (flow, state) => {
    for (const row of [["A", "B"], ["C", "D"]]) {
      await flow.startRow(); flow.boundary(100); flow.boundary(200);
      for (const text of row) {await flow.emit(text); await flow.cell(state);}
      await flow.row();
    }
  }, {[key]: 1});
});
it.each(["font", "color", "list", "unicode"])("preserves undefined or incomplete %s errors", async mode => {
  const source = mode === "font" ? String.raw`\deff1 X` : mode === "color" ? String.raw`\cf1 X` : mode === "list" ? String.raw`\ls2 X` : String.raw`\u-10179?`;
  await compare(String.raw`{\rtf1` + source + "}", async (flow, state) => {
    if (mode === "unicode") {await flow.unicode(0xd83d); return;}
    if (mode === "font") state.defaultFont = 1;
    if (mode === "color") state.color = 1;
    if (mode === "list") state.list = 2;
    await flow.emit("X");
  });
});
it("retains long words and many inline boundaries across input chunks", async () => {
  const content = "x".repeat(65537) + " a".repeat(128);
  await compare("{\\rtf1 " + content + "}", async flow => {
    for (let offset = 0; offset < content.length; offset += 257) await flow.emit(content.slice(offset, offset + 257));
  });
});

it("builds field targets from retained literal text with normalized tabs", async () => {
  await compare("{\\rtf1{\\field{\\*\\fldinst HYPERLINK \"a\tb\"}{\\fldrslt label}}}", async (flow, state, context) => {
    const ast = flow.ast;
    flow.literal = true; flow.inlineOnly = true;
    await flow.emit('HYPERLINK "a\tb"');
    const target = await retainedRtfHyperlink(ast.text, await flow.literalText(state), context);
    flow.inlines = await ast.array(); flow.literal = false; flow.inlineOnly = false;
    const label = await ast.value([await ast.tag("Str", await ast.value("label"))]);
    await flow.append(await ast.tag("Link", await ast.value([["", [], []], label, [await ast.string(target), ""]])));
  });
});
