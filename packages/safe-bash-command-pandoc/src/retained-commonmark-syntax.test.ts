import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedCommonMarkSyntax} from "./retained-commonmark-syntax.js";
import {readDestination, readTitle, readLabel, decodeSyntax, normalizeUri} from "./commonmark-syntax.js";

async function syntax(text: string, run: (syntax: RetainedCommonMarkSyntax, context: ExecutionContext) => Promise<void>) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  try {
    const source = new RetainedSourceText(storage, units => context.cooperate(units));
    await source.append([text]);
    await run(new RetainedCommonMarkSyntax(source, {start: 0, end: text.length}, context), context);
  } finally {await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}

it.each([
  "", "<>", "<hello world>", "<a\\>b>", "<a\nb>", "a(b(c))", "a(b", "a\\)b)",
  "'hello' rest", '"a\\"b"', "(title)", "(nested(title))", "'a\nb'", "'unclosed",
  "[label]", "[a\\]b]", "[nested[label]]", "[😀]", "[" + "a".repeat(1000) + "]",
].map((text, index) => ({text, index})))("matches resident scanners $index", async ({text}) => {
  await syntax(text, async (retained, context) => {
    for (const [resident, scan] of [[readDestination, retained.destination.bind(retained)], [readTitle, retained.title.bind(retained)]] as const) {
      const expected = resident(text, 0, context), actual = await scan(0);
      expect(actual && {value: await retained.small(actual.value, text.length), end: actual.end}).toEqual(expected);
    }
    expect(await retained.label(0)).toEqual(readLabel(text, 0, context));
  });
});

it("decodes and normalizes long destinations in bounded chunks", async () => {
  const text = ("é😀 a\\*b&amp;&#x1f600;%20").repeat(1000);
  await syntax(text, async (retained, context) => {
    const expected = decodeSyntax(text, context);
    let decoded = "", uri = "";
    for await (const chunk of retained.decoded(retained.range)) {expect(chunk.length).toBeLessThanOrEqual(4098); decoded += chunk;}
    for await (const chunk of retained.uri(retained.decoded(retained.range))) {expect(chunk.length).toBeLessThanOrEqual(4120); uri += chunk;}
    expect(decoded).toBe(expected); expect(uri).toBe(normalizeUri(expected, context));
  });
});

it("keeps arbitrarily long destinations and titles as source ranges", async () => {
  const text = "<" + "x".repeat(65537) + "> '" + "y".repeat(65537) + "'";
  await syntax(text, async retained => {
    expect(await retained.destination(0)).toEqual({value: {start: 1, end: 65538}, end: 65539});
    expect(await retained.title(65540)).toEqual({value: {start: 65541, end: 131078}, end: 131079});
    await expect(retained.small({start: 1, end: 65538}, 1998)).rejects.toThrow("bounded");
  });
});

it("preserves split surrogate pairs and URI errors", async () => {
  await syntax("", async (retained, context) => {
    let output = "";
    for await (const chunk of retained.uri(["\ud83d", "\ude00"])) output += chunk;
    expect(output).toBe(normalizeUri("😀", context));
    await expect((async () => {for await (const chunk of retained.uri(["\ud83d"])) void chunk;})()).rejects.toThrow(URIError);
  });
});
