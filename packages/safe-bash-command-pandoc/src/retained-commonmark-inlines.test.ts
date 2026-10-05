import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedCommonMarkSyntax} from "./retained-commonmark-syntax.js";
import {RetainedRtfAst} from "./retained-rtf-ast.js";
import {BackedJson} from "./backed-json.js";
import {parseRetainedCommonMarkInlines} from "./retained-commonmark-inlines.js";
import {normalizeLabel} from "./commonmark-syntax.js";
import {parseCommonMarkInlines} from "./commonmark-inlines.js";

const samples = [
  "<https://example.test/a> <a+b@x.test>", "[<https://example.test>](x)", '<i data-x="*">body</i>', "a <!--> b <!-- a --\nb -->",
  "<a:b> <https://a b> <red@-bad.test>", "https://example.test/a(b)). www.a.test a+b@x.test", "a https://example.test/?q=&amp; b",
  "<script>alert(1)</script>", "<!DOCTYPE html> <?pi ?> <![CDATA[x]]>", "x<https://example.test>",
  "[a] [a][] [text][ A ] ![a] [*a*][a] [text][missing]", "![a".repeat(128) + "body" + "](u)".repeat(128),
  "plain words", "a".repeat(65537), "*em* **strong** ***both***", "a_b_c a*b*c", "***a** b*", "a **b *c* d** e",
  "[label](target 'title')", "![image](<a b>)", "[a [b](c)](d)", "[not a link]", "a\\*b &amp; &#x1f600;", "a  \nb\nc\\\nd",
  "`a b` ``a`b`` ` unmatched", "` a\nb `", "~~gone~~", "a\t b ", "[a](b(c)d)", "[a]( 'title')", "[a](<é😀>)",
  "***".repeat(300), "[*a*](b) **[c](d)**", "[![a](b)](c)", "\\[literal]", "a &NotEqualTilde; b", "a\r\nb",
];
async function compare(text: string, extensions: Record<string, boolean> = {strikeout: true, raw_html: true, autolink_bare_uris: true}) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), stores: PagedStorage[] = [];
  const store = () => {const value = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1); stores.push(value); return value;};
  try {
    const source = new RetainedSourceText(store(), units => context.cooperate(units)); await source.append([text]);
    const destination = await source.append(["/target é"]), title = await source.append(["caption &amp;"]);
    const definitions = [{label: normalizeLabel("a", context), destination: "/target é", title: "caption &amp;", source: {source: "input", start: {line: 1, column: 1}, end: {line: 1, column: 1}}}];
    const syntax = new RetainedCommonMarkSyntax(source, {start: 0, end: text.length}, context), ast = new RetainedRtfAst(store(), units => context.cooperate(units));
    const actualCharges: Record<string, number> = {}, expectedCharges: Record<string, number> = {};
    let charges = actualCharges;
    const charge = context.charge.bind(context), spy = vi.spyOn(context, "charge").mockImplementation((key, units) => {charges[key] = (charges[key] ?? 0) + units; charge(key, units);});
    const value = await parseRetainedCommonMarkInlines(syntax, store(), ast, context, extensions, async label => label === "a" ? {destination, title} : undefined, {lines: 1, definitions: 1});
    charges = expectedCharges;
    const expected = await parseCommonMarkInlines({kind: "pendingInline", lines: [{text, start: {line: 1, column: 1}}]}, definitions, context, extensions);
    spy.mockRestore();
    expect(actualCharges).toEqual(expectedCharges);
    const wire = new BackedJson(store(), units => context.cooperate(units)); await ast.write(value, wire);
    let serialized = ""; for await (const chunk of wire.chunks()) serialized += new TextDecoder().decode(chunk);
    expect(JSON.parse(serialized)).toEqual(expected);
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each(samples.map((text, index) => ({text, index})))("retains inline grammar $index", async ({text}) => {await compare(text);});

it("preserves mixed delimiter, HTML, link, and entity boundaries", async () => {
  const tokens = ["a", "b", " ", "\n", "*", "**", "_", "__", "~", "~~", "[", "]", "(", ")", "!", "`", "``", "\\", "&amp;", "😀", "<i>", "</i>", "<https://x.test>", "www.x.test", "a@b.test", "'", "<script>"];
  let state = 1772;
  for (let sample = 0; sample < 300; sample++) {
    let text = "";
    for (let i = 0; i < 18; i++) {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; text += tokens[state % tokens.length];}
    await compare(text, {strikeout: true, single_tilde: sample % 2 === 0, raw_html: sample % 3 === 0, autolink_bare_uris: true});
  }
});
