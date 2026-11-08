import {expect, it} from "vitest";
import {Lexer} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlLexer} from "./retained-yaml-lexer.js";

async function fixture(text: string, run: (source: RetainedSourceText) => Promise<void>) {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const source = new RetainedSourceText(storage, async () => {});
  await source.append(["prefix", text, "suffix"]);
  try {await run(source);} finally {await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
async function compare(text: string) {
  const expected = [...new Lexer().lex(text)];
  await fixture(text, async source => {
    const actual: string[] = [];
    for await (const token of new RetainedYamlLexer(source, {start: 6, end: 6 + text.length}, async () => {}).lex()) {
      if (typeof token === "string") actual.push(token);
      else {
        let value = ""; for await (const chunk of source.chunks(token)) value += chunk;
        actual.push(value);
      }
    }
    expect(actual, text).toEqual(expected);
  });
}
const cases = [
  "", "title: hello\n", "a: [one, {two: 2}, true, null]\n", "a: &anchor [*anchor]\nb: *anchor\n",
  "a: !!str 12\nb: !<tag:example.com,2026:value> yes\n", "a: !local%20tag value\n",
  "a: |\n  hello\n  world\nb: yes\n", "a: >2- # comment\n  hello\n\n  world\nb: yes\n",
  "a: [\n  value\n]\n", "a: [\nvalue\n]\n", "a: [\n---\nvalue\n]\n",
  "a: 'one''two'\nb: \"one\\\"two\"\n", "a: \"one\n  two\"\n", "a: 'one\nbad\n'\n",
  "? [a, b]\n: {c: d}\n", "a:\n - one\n - two\n", "a: x # comment\n",
  "# comment\n\n---\na: 1\n...\n", "%YAML 1.2 # comment\n---\na: 1\n",
  "\uFEFFa: 1\n", "a: \"unterminated", "a: [bad,}", "a: |+\n  x\n\n\n",
  "a: |\n  x\n\t\n", "a: plain\n  continuation\n\n  last\n", "a: x\r\nb: y\r\n",
  "a: [\"x\":y, a:b, x: null, ?key, : ,,,]\n", "a: !foo!bar &x value\n",
];
it.each(cases)("matches the existing YAML lexer for %j", compare);
it("matches generated collection, scalar and whitespace token boundaries", async () => {
  const values = ["plain", "'quoted'", '"a\\nb"', "[a, b, {c: d}]", "{a: 1,b: 2}", "&ref [*ref]", "!!str 12", "*missing", "|2+\n  a\n\n", ">-\n  a\n    b\n  c\n"];
  for (const value of values) for (const indent of ["", " ", "   "]) for (const ending of ["", "\n", " # comment\n", "\r\n"]) {
    await compare(`${indent}key: ${value}${ending}${indent}next: true\n`);
  }
});
it("emits source spans for growing tokens without collecting their contents", async () => {
  for (const size of [4096, 16384, 65536]) {
    const text = `key: "${"x".repeat(size)}"\n`;
    await fixture(text, async source => {
      source.chunks = () => {throw new Error("lexer must not collect source spans");};
      let largest = 0;
      for await (const token of new RetainedYamlLexer(source, {start: 6, end: 6 + text.length}, async () => {}).lex()) {
        if (typeof token !== "string") largest = Math.max(largest, token.end - token.start);
      }
      expect(largest).toBe(size + 2);
    });
  }
});
it("cooperates within long comments, spaces, scalars, tags and anchors", async () => {
  for (const prefix of ["#", " ", "a: ", "a: &", "a: !", "a: '", 'a: "', "a: |\n  "]) {
    await fixture(prefix + "x".repeat(20000), async source => {
      const reason = new Error("cancelled"); let calls = 0;
      const lexer = new RetainedYamlLexer(source, {start: 6, end: source.length - 6}, async () => {if (++calls === 3) throw reason;});
      await expect((async () => {for await (const token of lexer.lex()) void token;})()).rejects.toBe(reason);
    });
  }
});
it("propagates backing read errors", async () => {
  await fixture("a: value\n", async source => {
    const reason = new Error("backing unavailable"); source.unit = async () => {throw reason;};
    await expect((async () => {for await (const token of new RetainedYamlLexer(source, {start: 6, end: source.length - 6}, async () => {}).lex()) void token;})()).rejects.toBe(reason);
  });
});
it("scans long flow lines in linear work", async () => {
  const text = "key: [" + "value, ".repeat(2000) + "]\n";
  await fixture(text, async source => {
    const unit = source.unit.bind(source); let reads = 0;
    source.unit = async index => {reads++; return unit(index);};
    for await (const token of new RetainedYamlLexer(source, {start: 6, end: 6 + text.length}, async () => {}).lex()) void token;
    expect(reads).toBeLessThan(text.length * 20);
  });
});
it("matches generated nested and malformed lexical boundaries", async () => {
  let seed = 914;
  const next = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  const parts = ["[", "]", "{", "}", ",", " ", "\t", "\n  ", "\r\n ", "key: ", "? ", "- ", "plain", "'a''b'", '"a\\"b"', "&a ", "*a ", "!!str ", "# comment\n", "|+\n  x\n"];
  for (let index = 0; index < 400; index++) {
    let text = "key: "; for (let count = next(12); count >= 0; count--) text += parts[next(parts.length)];
    await compare(text + "\n");
  }
});
