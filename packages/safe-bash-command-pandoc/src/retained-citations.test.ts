import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedRtfAst, type RtfValue} from "./retained-rtf-ast.js";
import {jsonWriter} from "./json.js";
import {BackedJson} from "./backed-json.js";
import {upgradeBracketedCitationsInBlocks} from "./citeproc-filters.js";
import {upgradeRetainedCitations} from "./retained-citations.js";
import type {Block} from "./ast-types.js";

async function compare(blocks: Block[]) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), stores: PagedStorage[] = [];
  const store = () => {const value = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1); stores.push(value); return value;};
  try {
    const ast = new RetainedRtfAst(store(), units => context.cooperate(units));
    const load = async (value: unknown): Promise<RtfValue> => {
      if (Array.isArray(value)) {const result = await ast.array(); for (const child of value) await ast.push(result, await load(child)); return result;}
      if (value && typeof value === "object" && "t" in value) return ast.tag(value.t as Parameters<typeof ast.tag>[0], "c" in value ? await load(value.c) : undefined);
      return ast.value(value as string | number | null);
    };
    const original = await jsonWriter.write({blocks, metadata: {}, resources: []}, context);
    const root = await load(JSON.parse(original.kind === "text" ? original.text : "{}").blocks), source = new RetainedSourceText(store(), units => context.cooperate(units));
    await upgradeRetainedCitations(root, ast, source, context);
    const wire = new BackedJson(store(), units => context.cooperate(units)); await ast.write(root, wire);
    let actual = ""; for await (const bytes of wire.chunks()) actual += new TextDecoder().decode(bytes);
    const expected = await jsonWriter.write({blocks: upgradeBracketedCitationsInBlocks(blocks), metadata: {}, resources: []}, context);
    expect(expected.kind).toBe("text");
    expect(JSON.parse(actual)).toEqual(JSON.parse(expected.kind === "text" ? expected.text : "{}").blocks);
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
const samples = [
  "[@key]", "before [@key] after [-@other]", "[see @a]", "[@trigger] [see @a, p. 2; -@b]",
  "[@a;; @b]", "[@a; nonsense]", "[@a; ;@b]", "[@a; suffix @b]", "[@a@b]", "[prefix @bad@valid] [@a]",
  "[@] [@a]", "[@a[b] [@c]", "[[@a]]", "[@a;@b, pp. 2–3]", "[-@a] [--@b]",
  "[@a, suffix] [@a , suffix]", "[@a\n\t;\n@b]", "[@a] [@a;]", "[@a] [;prefix @b]",
  "[@a] [@b; @;@c]", "[@a] [@b; bad@;@c]", "[prefix@a] only", "[@a] [prefix@a]",
  "[@" + "key".repeat(22000) + "]", "[@a," + "suffix ".repeat(10000) + "]",
];
it.each(samples.map((text, index) => ({text, index})))("retains citation grammar $index", async ({text}) => compare([{t: "Para", c: [{t: "Str", c: text}]}]));
it("preserves the existing block and inline traversal boundary", async () => {
  const str = {t: "Str", c: "[@a]"} as const, para = {t: "Para", c: [str]} as const;
  await compare([
    {t: "Header", c: [2, ["", [], []], [str]]},
    {t: "Div", c: [["", [], []], [{t: "BlockQuote", c: [{t: "BulletList", c: [[para]]}]}]]},
    {t: "OrderedList", c: [[1, "Decimal", "Period"], [[para]]]},
    {t: "Para", c: [{t: "Strong", c: [{t: "Emph", c: [str]}]}, {t: "Span", c: [["", [], []], [str]]},
      {t: "Link", c: [["", [], []], [str], ["url", ""]]}, {t: "Image", c: [["", [], []], [str], ["url", ""]]}, {t: "Note", c: [para]}]},
    {t: "CodeBlock", c: [["", [], []], "[@a]"]},
    {t: "Table", c: [["", [], []], [null, []], [], [["", [], []], [[["", [], []], [[["", [], []], "AlignDefault", 1, 1, [para]]]]]], [], [["", [], []], []]]}
  ]);
});
it("matches mixed citation punctuation", async () => {
  const tokens = ["[", "]", "@", "-", ";", ",", "a", " ", "\n", "é", ":", "_", "[prefix", "[@a]", "[-@b]"];
  let seed = 1772;
  for (let i = 0; i < 250; i++) {
    let text = "";
    for (let j = 0; j < 25; j++) {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += tokens[seed % tokens.length];}
    await compare([{t: "Plain", c: [{t: "Str", c: text}]}]);
  }
});

it.each(["cancel", "storage"])("closes scratch after %s during citation upgrade", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let upgrading = false;
  const context = new ExecutionContext("convert", {signal: controller.signal, async yield() {if (upgrading && mode === "cancel") controller.abort();}});
  const owner = {fs, cwd: "/", env: {}, signal: controller.signal}, nodes = new PagedStorage(owner, 1), sourceStore = new PagedStorage(owner, 1);
  try {
    const ast = new RetainedRtfAst(nodes, units => context.cooperate(units));
    const root = await ast.value([await ast.tag("Para", await ast.value([await ast.tag("Str", await ast.value("[@" + "a".repeat(65536) + "]"))]))]);
    const source = new RetainedSourceText(sourceStore, units => context.cooperate(units));
    const write = sourceStore.write.bind(sourceStore); let writes = 0;
    if (mode === "storage") vi.spyOn(sourceStore, "write").mockImplementation(async (...args) => {if (++writes === 8) throw new Error("Storage failed"); await write(...args);});
    upgrading = true;
    await expect(upgradeRetainedCitations(root, ast, source, context)).rejects.toThrow(mode === "cancel" ? "Conversion cancelled" : "Storage failed");
  } finally {await nodes.close(); await sourceStore.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
