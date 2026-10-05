import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedCommonMarkBlocks} from "./retained-commonmark-blocks.js";
import {parseCommonMarkBlocks, type PendingBlock} from "./commonmark-blocks.js";

const samples = [
  "a\u0000b\n", "```a\u0000b\nx\u0000y\n```", "[a\u0000b]: /x\u0000y\n[a\u0000b]",
  "[a]:\n<>\nbody", "[a]: <> \nbody", "[a]: x 'bad\n(title\nbody", "[a]: x\n(title\n(nested)\nbody", "[a]: x 'title' junk\nbody",
  "[a]: x\n'bad\nbody", "[a]: x\n'good' junk\nbody", "[a]: <bad\nnext>\nbody", "[a]: x)\nbody",
  "a|b\n-|:-\nx|y\\", "\\|", "|\n|\n", "<script", "<div", "<blockquote>body\n", "<custom attr=x>\nraw\n\nend",
  "", "a\nb\n\nc", "# heading #\n\n---\n", "title\n===\n", "a".repeat(65537), "a\r\nb\rc\n",
  "```js\ncode\n```\n\n    indented\n\n    more\n", "  ```\n\tx\n  ```", "> one\n>\n> two\nlazy\n",
  "- a\n- b\n\n- c\n", "1. first\n   continuation\n2. next\n", "> - a\n>   - b\n>\n>   c\n",
  "a|b\n:--|--:\none|two\nthree|four|extra\n", "|a\\|b|c|\n|---|---|\n|`a\\|b`|c|\n",
  "[a]: /target 'title'\n[a]\n", "[a\nb]:\n /target\n 'title\nmore'\nbody", "[a]: x\n[A]: y\n", "[a]: x\n---\n",
  "<div>\nraw\n\nbody", "<script>\nraw\n</script>\nbody", "<!-- comment\nend -->\n", "<?pi\nx?>\n",
  "[^note]: body\n    continuation\n\nparagraph", "\t".repeat(2048) + "x", "-\n\n  para\n", "a\n- b\n",
];
async function compare(text: string, extensions: Record<string, boolean> = {pipe_tables: true, raw_html: true, footnotes: true}) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), stores: PagedStorage[] = [];
  const store = () => {const value = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1); stores.push(value); return value;};
  try {
    const source = new RetainedSourceText(store(), units => context.cooperate(units)); await source.append([text]);
    const parser = new RetainedCommonMarkBlocks(source, store(), context, "input.md", extensions);
    const actualCharges: Record<string, number> = {}, expectedCharges: Record<string, number> = {}; let charges = actualCharges;
    const charge = context.charge.bind(context), spy = vi.spyOn(context, "charge").mockImplementation((key, units) => {charges[key] = (charges[key] ?? 0) + units; charge(key, units);});
    await parser.parse({start: 0, end: text.length});
    charges = expectedCharges;
    const expected = await parseCommonMarkBlocks(text, context, "input.md", extensions); spy.mockRestore();
    expect(actualCharges, text).toEqual(expectedCharges);
    const literal = async (range: {start: number; end: number}) => {let result = ""; for await (const chunk of source.chunks(range)) result += chunk; return result;};
    const blocks = async (parent: number): Promise<PendingBlock[]> => {
      const result: PendingBlock[] = [];
      for await (const position of parser.children(parent)) {
        const node = await parser.node(position), location = {source: "input.md", start: {line: node.startLine, column: node.startColumn}, end: {line: node.endLine, column: node.endColumn}};
        const lines = []; for await (const line of parser.lines(position)) lines.push({text: await literal(line.range), start: {line: line.line, column: line.column}});
        const inline = {kind: "pendingInline" as const, lines};
        if (node.kind === "paragraph") result.push({kind: node.kind, inline, source: location});
        else if (node.kind === "heading") result.push({kind: node.kind, level: node.number, inline, source: location});
        else if (node.kind === "code" || node.kind === "html") {
          const value = lines.map(line => line.text).join("");
          result.push(node.kind === "code" ? {kind: node.kind, info: await literal(node.info), literal: value, source: location} : {kind: node.kind, literal: value, source: location});
        } else if (node.kind === "quote" || node.kind === "footnote") {
          const children = await blocks(position);
          result.push(node.kind === "quote" ? {kind: node.kind, blocks: children, source: location} : {kind: node.kind, label: await literal(node.info), blocks: children, source: location});
        } else if (node.kind === "list") {
          const items = [];
          for await (const child of parser.children(position)) {const item = await parser.node(child); items.push({blocks: await blocks(child), source: {source: "input.md", start: {line: item.startLine, column: item.startColumn}, end: {line: item.endLine, column: item.endColumn}}});}
          result.push({kind: node.kind, start: Number.isNaN(node.number) ? null : node.number, marker: String.fromCharCode(node.marker), tight: !!node.tight, items, source: location});
        } else if (node.kind === "table") {
          const rows: string[][] = []; let alignments: ("AlignDefault" | "AlignLeft" | "AlignRight" | "AlignCenter")[] = [];
          for await (const child of parser.children(position)) {const cells = []; const alignment: typeof alignments = []; for await (const cell of parser.lines(child)) {cells.push(await literal(cell.range)); alignment.push((["AlignDefault", "AlignLeft", "AlignRight", "AlignCenter"] as const)[cell.alignment]!);} rows.push(cells); if (rows.length === 1) alignments = alignment;}
          result.push({kind: node.kind, header: rows[0]!, rows: rows.slice(1), alignments, source: location});
        } else result.push({kind: "thematicBreak", source: location});
      }
      return result;
    };
    const definitions = []; for await (const value of parser.definitions()) definitions.push({label: await literal(value.label), destination: await literal(value.destination), title: await literal(value.title), source: {source: "input.md", start: {line: value.startLine, column: value.startColumn}, end: {line: value.endLine, column: value.endColumn}}});
    expect({blocks: await blocks(parser.root), definitions}, text).toEqual(expected);
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each(samples.map((text, index) => ({text, index})))("retains CommonMark block grammar $index", async ({text}) => {await compare(text);});

it("matches mixed block and container boundaries", async () => {
  const lines = ["a", "", " ", "  ", "\t", "# head", "##", "---", "===", "___", "- a", "-", "* b", "1. a", "2. b", "> a", ">", "> - b", "  - c", "    a", "```x", "```", "~~~", "<div>", "</div>", "<!--", "-->", "<script>", "</script>", "a|b", "--|--", "|x|y|", "[a]: x", "[a]: x 'title'", "[a", "b]: y", "[^n]: a", "  continuation", "  \t text"];
  let state = 1772;
  for (let sample = 0; sample < 250; sample++) {
    let text = "";
    for (let i = 0; i < 9; i++) {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; text += lines[state % lines.length] + (i % 3 === 0 ? "\r\n" : "\n");}
    await compare(text, {pipe_tables: true, raw_html: sample % 2 === 0, footnotes: true, preserve_table_columns: sample % 3 === 0});
  }
});

it.each(["retainedBytes", "references", "nodes", "text", "depth", "tableCells"] as const)("preserves block %s failures", async budget => {
  const text = "# head\n\n- a\n  - b\n\n<div>x</div>\n\n    code\n\n[a]: target 'title'\n\nx|y\n--|--\na|b\n";
  for (const limit of [0, 1, 8, 32, 64, 128, 300, 350, 400, 450, 500, 512, 1024, 2048, 4096, 8192]) {
    const fs = new MemoryFileSystem(), expectedContext = new ExecutionContext("convert", {limits: {[budget]: limit}}), context = new ExecutionContext("convert", {limits: {[budget]: limit}});
    const owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal}, sourceStore = new PagedStorage(owner, 1), tape = new PagedStorage(owner, 1);
    try {
      const source = new RetainedSourceText(sourceStore, units => context.cooperate(units)); await source.append([text]);
      const expected = await parseCommonMarkBlocks(text, expectedContext, "input.md", {pipe_tables: true, raw_html: true}).then(() => undefined, error => error);
      const parser = new RetainedCommonMarkBlocks(source, tape, context, "input.md", {pipe_tables: true, raw_html: true});
      const actual = await parser.parse({start: 0, end: text.length}).then(() => undefined, error => error);
      if (expected) expect(actual, `${budget}=${limit}`).toMatchObject({code: expected.code, message: expected.message}); else expect(actual).toBeUndefined();
    } finally {await sourceStore.close(); await tape.close(); await context.close(); await expectedContext.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});

it.each(["cancel", "storage"])("releases caller scratch after %s during block parsing", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(); let parsing = false;
  const context = new ExecutionContext("convert", {signal: controller.signal, async yield() {if (parsing && mode === "cancel") controller.abort();}});
  const owner = {fs, cwd: "/", env: {}, signal: controller.signal}, sourceStore = new PagedStorage(owner, 1), tape = new PagedStorage(owner, 1);
  const open = vi.spyOn(fs, "open");
  try {
    const source = new RetainedSourceText(sourceStore, units => context.cooperate(units)), text = "body\n\n".repeat(300); await source.append([text]);
    const write = tape.write.bind(tape); let writes = 0;
    if (mode === "storage") vi.spyOn(tape, "write").mockImplementation(async (...args) => {if (++writes === 800) throw new Error("Storage failed"); await write(...args);});
    parsing = true;
    const parser = new RetainedCommonMarkBlocks(source, tape, context);
    await expect(parser.parse({start: 0, end: text.length})).rejects.toThrow(mode === "cancel" ? "Conversion cancelled" : "Storage failed");
    if (mode === "storage") expect(open).toHaveBeenCalled();
  } finally {await sourceStore.close(); await tape.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});
