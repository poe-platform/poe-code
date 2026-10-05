import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import type {Limits} from "./types.js";
import {ExecutionContext} from "./execution.js";
import {BackedJson} from "./backed-json.js";
import {RetainedRtfAst, type RtfValue} from "./retained-rtf-ast.js";
import {RetainedEpubNotes} from "./retained-epub-notes.js";

async function fixture(run: (ast: RetainedRtfAst, notes: RetainedEpubNotes, render: (root: RtfValue) => Promise<unknown>) => Promise<void>, limits: Partial<Limits> = {}) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const storage = new PagedStorage(owner, 1), wire = new PagedStorage(owner, 1);
  const ctx = new ExecutionContext("read", {limits, yield: async () => {}});
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole reads forbidden"));
  const ast = new RetainedRtfAst(storage, units => ctx.cooperate(units));
  try {
    await run(ast, new RetainedEpubNotes(ast, storage, ctx), async root => {
      const tree = new BackedJson(wire, units => ctx.cooperate(units));
      await ast.write(root, tree);
      let text = ""; for await (const bytes of tree.chunks()) text += new TextDecoder().decode(bytes);
      return JSON.parse(text);
    });
  } finally {await storage.close(); await wire.close(); await ctx.close();}
  expect(await fs.readdir("/")).toEqual([]);
}
const reference = async (ast: RetainedRtfAst, key: string) => ast.tag("Link", await ast.value([["", [], [["data-epub-type", "noteref"]]], [await ast.tag("Str", await ast.value("1"))], ["#" + encodeURI(key), ""]]));

it("expands repeated EPUB note references independently and retains the original anchor", async () => {
  await fixture(async (ast, notes, render) => {
    const prose = await ast.value([await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("shared"))]))]);
    const definition = await ast.tag("Div", await ast.value([["notes.xhtml#n", [], []], prose]));
    const first = await reference(ast, "notes.xhtml#n"), second = await reference(ast, "notes.xhtml#n");
    const root = await ast.value([first, second, definition]);
    await notes.add("notes.xhtml#n", prose);
    await notes.expand(root); await notes.prune(root);
    const firstDiv = (await ast.edge((await ast.content(first))!))!;
    const firstCopy = (await ast.at((await ast.content(firstDiv))!, 1))!;
    await ast.push(firstCopy, await ast.tag("HorizontalRule"));
    const result = await render(root) as {t: string; c: unknown[]}[];
    expect(result[0]).toEqual({t: "Note", c: [{t: "Div", c: [["", [], [["data-epub-source", "notes.xhtml"]]], [{t: "Para", c: [{t: "Str", c: "shared"}]}, {t: "HorizontalRule"}]]}]});
    expect(result[1]).toEqual({t: "Note", c: [{t: "Div", c: [["", [], [["data-epub-source", "notes.xhtml"]]], [{t: "Para", c: [{t: "Str", c: "shared"}]}]]}]});
    expect(result[2]).toEqual({t: "Div", c: [["notes.xhtml#n", [], []], []]});
    expect(await ast.count(prose)).toBe(1);
  });
});

it("expands nested EPUB references without classifying repeated references as cycles", async () => {
  await fixture(async (ast, notes, render) => {
    await notes.add("n.xhtml#b", await ast.value([await ast.tag("HorizontalRule")]));
    await notes.add("n.xhtml#a", await ast.value([await reference(ast, "n.xhtml#b"), await reference(ast, "n.xhtml#b")]));
    const root = await reference(ast, "n.xhtml#a");
    await notes.expand(root);
    expect(JSON.stringify(await render(root)).match(/HorizontalRule/g)).toHaveLength(2);
  });
});

it("rejects recursive EPUB note dependencies through retained active membership", async () => {
  await fixture(async (ast, notes) => {
    await notes.add("n.xhtml#a", await ast.value([await reference(ast, "n.xhtml#b")]));
    await notes.add("n.xhtml#b", await ast.value([await reference(ast, "n.xhtml#a")]));
    await expect(notes.expand(await reference(ast, "n.xhtml#a"))).rejects.toMatchObject({code: "E_PARSE", message: expect.stringContaining("Recursive EPUB note dependency")});
  });
});

it("rejects missing note targets and leaves ordinary links intact", async () => {
  await fixture(async (ast, notes) => {
    const ordinary = await ast.tag("Link", await ast.value([["", [], []], [], ["#missing", ""]]));
    await notes.expand(ordinary); expect(await ast.name(ordinary)).toBe("Link");
    await expect(notes.expand(await reference(ast, "n.xhtml#missing"))).rejects.toMatchObject({code: "E_PARSE", message: expect.stringContaining("Missing EPUB note target")});
  });
});


it.each(["nodes", "retainedBytes", "depth"] as const)("enforces the %s budget while expanding note copies", async budget => {
  await expect(fixture(async (ast, notes) => {
    await notes.add("n.xhtml#a", await ast.value([await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("prose"))]))]));
    await notes.expand(await reference(ast, "n.xhtml#a"));
  }, {[budget]: 0})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("finds noteref after arbitrarily long unsupported EPUB type tokens", async () => {
  await fixture(async (ast, notes, render) => {
    await notes.add("n.xhtml#a", await ast.value([await ast.tag("HorizontalRule")]));
    const type = await ast.string(await ast.text.from(["x".repeat(32768), " noteref"]));
    const link = await ast.tag("Link", await ast.value([["", [], [["data-epub-type", type]]], [], ["#n.xhtml#a", ""]]));
    await notes.expand(link);
    expect(await render(link)).toEqual({t: "Note", c: [{t: "Div", c: [["", [], [["data-epub-source", "n.xhtml"]]], [{t: "HorizontalRule"}]]}]});
  });
});
