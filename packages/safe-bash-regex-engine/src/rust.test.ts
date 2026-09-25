import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "./text/regex.js";
import { ProgramError } from "./text/budget.js";

const budget = { step() {}, async checkpoint() {}, maxBufferBytes: 65536 };

for (const [source, input, expected] of [
  ["^\\w+$", "猫", "猫"],
  ["^\\d+$", "١٢", "١٢"],
  ["\\p{Greek}+", "Καλημέρα", "Καλημέρα"],
  ["\\p{Han}+", "猫", "猫"],
  ["\\p{Script=Greek}+", "αβ", "αβ"],
  ["[\\p{Greek}&&[^β]]+", "βαγ", "αγ"],
  ["[a-z&&[^b]]+", "bcad", "cad"],
  ["(?i)Σ", "ς", "ς"],
  ["(?i)s", "ſ", "ſ"],
  ["(?i)i", "İ", undefined],
  ["(?i)i", "ı", undefined],
  ["(?i)ß", "ẞ", "ẞ"],
  ["(?m)^world", "hello\nworld", "world"],
  ["(?s)hello.world", "hello\nworld", "hello\nworld"],
  ["(?x) hello \\s+ world ", "hello world", "hello world"],
  ["(?i:hello)WORLD", "HELLOworld", undefined],
  ["(?i:hello)WORLD", "HELLOWORLD", "HELLOWORLD"],
  ["(?i)hello(?-i)WORLD", "HELLOWORLD", "HELLOWORLD"],
  ["(?P<word>hello)", "hello", "hello"],
  ["\\b猫\\b", "猫", "猫"],
  ["\\b猫\\b", "a猫", undefined],
  ["[😀-🙏]+", "😊", "😊"],
  ["\\x{1F60A}", "😊", "😊"],
  ["a$", "a\n", undefined],
  ["(a)?(?(1)b|c)", "ab", "ab"],
  ["(a)?(?(1)b|c)", "c", "c"],
  ["(?(a)b|c)", "ab", "ab"],
  ["(?((?=a))a|b)", "a", "a"],
  ["(?P<w>ab)(?P=w)", "abab", "abab"],
  ["(ab)\\k<-1>", "abab", "abab"],
  ["(?>a|ab)c", "abc", undefined],
  ["(?>ab|a)c", "abc", "abc"],
  ["a++a", "aaa", undefined],
  ["a(?# comment)b", "ab", "ab"],
  ["\\Gabc", "xabc", undefined],
  ["a\\Kb", "ab", "b"],
  ["\\<cat\\>", "cat", "cat"],
  ["\\h+", "xyz1ab", "1ab"],
  ["\\H+", "xyz1ab", "xyz"],
  ["a\\Z", "a\n\n", "a"],
  ["\\1(a)", "aa", undefined],
] as const) {
  test(`bounded Rust regex ${source} on ${JSON.stringify(input)}`, async () => {
    const pattern = new Pattern(source, true, false, "rust");
    assert.equal((await pattern.find(input, budget))?.groups[0], expected);
  });
}

test("Rust named groups retain the shared capture API", async () => {
  const pattern = new Pattern("(?P<word>猫+)", true, false, "rust");
  assert.equal((await pattern.find("猫猫", budget))?.groups[pattern.groupNames.get("word")!], "猫猫");
});

test("the jq dialect retains ASCII classes and final-newline anchors", async () => {
  assert.equal(await new Pattern("^\\w+$", true, false, "jq").find("猫", budget), undefined);
  assert.equal((await new Pattern("a$", true, false, "jq").find("a\n", budget))?.groups[0], "a");
});

test("Rust regex parsing bounds source, nesting and instruction expansion", () => {
  assert.throws(() => new Pattern("a".repeat(8193), true, false, "rust"), /source limit/u);
  assert.throws(() => new Pattern("(".repeat(65) + "a" + ")".repeat(65), true, false, "rust"), /depth limit/u);
  assert.throws(() => new Pattern("(?:a{1024}){1024}", true, false, "rust"), /program limit/u);
  assert.throws(() => new Pattern("(?:(?(a)a{1000}|b{1000})){1000}", true, false, "rust"), /program limit/u);
});

test("Rust regex backtracking and lookbehind charge the bounded VM", async () => {
  const workLimit = new Error("work exhausted");
  for (const source of ["(a+)+$", "(?<=a+)b", "(?(a+)(a+)+$|b)"]) {
    let work = 0;
    const bounded = { maxBufferBytes: 65536, async checkpoint() {}, step(units = 1) { work += units; if (work > 256) throw workLimit; } };
    await assert.rejects(new Pattern(source, true, false, "rust").find("a".repeat(80) + "!", bounded), error => error === workLimit);
    assert.ok(work <= 400);
  }
  await assert.rejects(new Pattern("(a|aa)+$", true, false, "rust").find("aaa!", { ...budget, maxBufferBytes: 1 }), ProgramError);
});
