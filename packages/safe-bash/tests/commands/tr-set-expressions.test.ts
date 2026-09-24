import assert from "node:assert/strict";
import test from "node:test";
import { chunks, run } from "./helpers.js";

for (const [args, stdin, expected] of [
  [["-d", "[:]"], "[a:b]\n", "ab\n"],
  [["[:]", "   "], "[a:b]\n", " a b \n"],
  [["-d", "[:0-9]"], "[a:5]\n", "a\n"],
  [["a-z", "[x*]"], "hello\n", "xxxxx\n"],
  [["a-e", "[x*3]yz"], "abcde\n", "xxxyz\n"],
  [["a-e", "[x*03]yz"], "abcde", "xxxyz"],
  [["a-e", "[x*0]"], "abcde", "xxxxx"],
  [["a-e", "[x*]yz"], "abcde", "xxxyz"],
  [["a-e", "[x*999999999999999999999]yz"], "abcde", "xxxxx"],
  [["a-j", "[x*010]yz"], "abcdefghij", "xxxxxxxxyz"],
  [["a-e", "[\\170*3]yz"], "abcde", "xxxyz"],
  [["-c", "x", "[y*]"], "abcx", "yyyx"],
  [["-ts", "a-e", "[x*3]"], "abcde", "xde"],
  [["-ds", "a", "[x*3]"], "axxxb", "xb"],
  [["-d", "[=a=]"], "a=b[c]\n", "=b[c]\n"],
  [["[=a=]", "x"], "a=b[c]", "x=b[c]"],
  [["-d", "[=\\141=]"], "a=b[c]", "=b[c]"],
  [["-d", "[:digit:]"], "a1b2", "ab"],
] as const) {
  test(`tr set expressions: ${JSON.stringify(args)}`, async () => {
    const result = await run("tr", [...args], { stdin: chunks(stdin) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

for (const args of [["[x*3]", "a"], ["abc", "[x*08]"], ["abc", "[x*]yz[z*]"], ["-d", "[:unknown:]"]]) {
  test(`tr rejects invalid set expression: ${JSON.stringify(args)}`, async () => {
    const result = await run("tr", args);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.startsWith("tr: "));
  });
}
