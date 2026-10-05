import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedCommonMarkBlocks} from "./retained-commonmark-blocks.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
import {BackedJson} from "./backed-json.js";
import {assembleRetainedCommonMark} from "./retained-commonmark-document.js";
import {convert} from "./engine.js";

const samples = [
  "[@a] **[-@b]**\n\n> [@c]\n\n- [@d]\n\n![[@e]](img) [link\n[@f]](url)",
  "a\u0000b\n", "```a\u0000b\nx\u0000y\n```", "[a\u0000b]: /x\u0000y\n[a\u0000b]",
  "# Title\n\nText with *emphasis*, **bold**, [link](target 'title') and ![image](image.png).",
  "> - outer\n>   - inner\n>\n>   paragraph\n", "1. one\n2. two\n\n   three\n",
  "- [x] done\n- [ ] todo\n  - [X] nested\n", "- [x] **bold**\n\n  another block\n", "- [ ]\n",
  "a|b\n:--|--:\nx|*y*\nz\n", "|a\\|b|c|\n|:--:|--|\n|x|[ref]|\n\n[ref]: target\n",
  "```js extra\nx\n```\n\n    code\n\n    more\n", "<script>\nbody\n</script>\n\n<div>safe</div>",
  "[ref]\n\n[ref]: /target 'title'\n", "a".repeat(65537), "> ".repeat(100) + "*body*",
];
it.each(samples.map((text, index) => ({text, index})))("assembles backed Markdown body $index", async ({text}) => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), stores: PagedStorage[] = [];
  const store = () => {const value = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1); stores.push(value); return value;};
  try {
    const source = new RetainedSourceText(store(), units => context.cooperate(units)); await source.append([text]);
    const extensions = {citations: true, pipe_tables: true, raw_html: true, strikeout: true, task_lists: true, autolink_bare_uris: true};
    const blocks = new RetainedCommonMarkBlocks(source, store(), context, "input", extensions); await blocks.parse({start: 0, end: text.length});
    const ast = new RetainedRtfAst(store(), units => context.cooperate(units));
    const result = await assembleRetainedCommonMark(blocks, ast, store(), context, extensions);
    const wire = new BackedJson(store(), units => context.cooperate(units)); await ast.write(result, wire);
    let actual = ""; for await (const bytes of wire.chunks()) actual += new TextDecoder().decode(bytes);
    const expected = await convert([{bytes: new TextEncoder().encode(text)}], {from: "gfm+citations", to: "json", fileScope: true}, {});
    expect(expected.kind).toBe("text");
    expect(JSON.parse(actual)).toEqual(JSON.parse(expected.kind === "text" ? expected.text : "{}").blocks);
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});

const originSamples = [
  "![one](a.png)\ntext\n![two](b.png)",
  "> ![quote](q.png)\n> continued ![next](n.png)\n\n- [x] ![task](t.png)",
  "![outer ![inner](i.png)](o.png)\n![ref]\n\n[ref]: r.png",
  "a|b\n--|--\n![one](a.png)|![two](b.png)\n",
  "prefix\r\n![crlf](x.png)\r![cr](y.png)",
];
it.each(originSamples)("preserves image source lines for %j", async text => {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), stores: PagedStorage[] = [];
  const store = () => {const value = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1); stores.push(value); return value;};
  try {
    const source = new RetainedSourceText(store(), units => context.cooperate(units)); await source.append([text]);
    const extensions = {pipe_tables: true, task_lists: true};
    const blocks = new RetainedCommonMarkBlocks(source, store(), context, "input", extensions); await blocks.parse({start: 0, end: text.length});
    const ast = new RetainedRtfAst(store(), units => context.cooperate(units));
    const actual: {url: string; line: number}[] = [], expected: typeof actual = [];
    await assembleRetainedCommonMark(blocks, ast, store(), context, extensions, async (target, line) => {
      let url = ""; for await (const chunk of ast.text.chunks(await ast.range(target))) url += chunk;
      actual.push({url, line});
    });
    const {readCommonMark} = await import("./commonmark.js");
    const resident = Object.assign(new ExecutionContext("convert", {}), {resourceTarget(target: object, line: number) {expected.push({url: (target as string[])[0]!, line});}});
    try {await readCommonMark({bytes: new TextEncoder().encode(text), text}, resident, {extensions} as never);} finally {await resident.close();}
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
