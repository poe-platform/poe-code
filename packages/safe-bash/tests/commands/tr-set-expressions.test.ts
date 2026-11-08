import assert from "node:assert/strict";
import test from "node:test";
import { chunks, run } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { CommandRegistry } from "../../src/contracts/index.js";

for (const [args, stdin, expected] of [
  [["-d", "[:]"], "[a:b]\n", "ab\n"],
  [["[:]", "   "], "[a:b]\n", " a b \n"],
  [["-d", "[:0-9]"], "[a:5]\n", "a\n"],
  [["a-z", "[x*]"], "hello\n", "xxxxx\n"],
  [["abc", "[=*]"], "abc\n", "===\n"],
  [["abcde", "[=*3]yz"], "abcde", "===yz"],
  [["abc", "[=*0]"], "abc", "==="],
  [["abc", "[\\075*]"], "abc", "==="],
  [["[===]", "x"], "a=b", "axb"],
  [["-s", "a", "[b*]"], "aaa", "b"],
  [["ab[:upper:]", "[:*2][:lower:]"], "abCD\n", "::cd\n"],
  [["abcd", "[:*2]:]"], "abcd", ":::]"],
  [["abcd", "[:*]:]"], "abcd", ":::]"],
  [["abcd", "[:*0]:]"], "abcd", ":::]"],
  [["a-e", "[x*3]yz"], "abcde\n", "xxxyz\n"],
  [["a-e", "[x*03]yz"], "abcde", "xxxyz"],
  [["a-e", "[x*0]"], "abcde", "xxxxx"],
  [["a-e", "[x*]yz"], "abcde", "xxxyz"],
  [["a-e", "[x*999999999999999999999]yz"], "abcde", "xxxxx"],
  [["a-j", "[x*010]yz"], "abcdefghij", "xxxxxxxxyz"],
  [["a-e", "[\\170*3]yz"], "abcde", "xxxyz"],
  [["[x*3]", "a"], "x[x*3]xyz\n", "a[a*3]ayz\n"],
  [["-d", "[x*3]"], "x[x*3]xyz\n", "[*3]yz\n"],
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

for (const args of [["[x*]", "a"], ["[x*0]", "a"], ["abc", "[x*08]"], ["abc", "[x*]yz[z*]"], ["-d", "[:unknown:]"], ["-ds", "a", "[b*]"], ["-ds", "a", "[b*0]"]]) {
  test(`tr rejects invalid set expression: ${JSON.stringify(args)}`, async () => {
    const result = await run("tr", args);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.startsWith("tr: "));
  });
}

for (const [args, input, expected, status] of [
  ["'é' 'x'", "é", "xx", 0],
  ["-d 'é'", "aé", "a", 0],
  ["-s 'é'", "éé", "éé", 0],
  ["'a' 'é'", "a", "�", 0],
  ["'0-9a-z' '[:digit:]'", "abc", "", 1],
  ["-s '0-9a-z' '[:digit:]'", "abc", "", 1],
  ["'0-9' '[:upper:]'", "123", "", 1],
  ["'a[:lower:]' '[:upper:]'", "abc", "", 1],
  ["'a-z' '[:upper:]'", "abc", "", 1],
  ["'A-Z' '[:lower:]'", "ABC", "", 1],
  ["'[:lower:]' '[:upper:]'", "abc", "ABC", 0],
  ["'[:upper:]' '[:lower:]'", "ABC", "abc", 0],
  ["'a[:lower:]' 'b[:upper:]'", "abc", "ABC", 0],
  ["'a-z' 'A-Z'", "abc", "ABC", 0],
] as const) {
  for (const mode of ["substitution", "loop", "arithmetic-loop"] as const) {
    test(`tr optimized ${mode}: ${args}`, async () => {
      const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
      try {
        const pipeline = `printf '%s' '${input}' | tr ${args}`;
        const direct = await shell.exec(pipeline);
        assert.equal(direct.exitCode, status, direct.stderr);
        assert.equal(direct.stdout, expected);
        const assignment = `out=$(${pipeline}); status=$?`;
        const body = mode === "substitution" ? assignment : `${mode === "loop" ? "for i in 1 2" : "for ((i=0;i<2;i++))"}; do ${assignment}; done`;
        const result = await shell.exec(`${body}; printf '%s' "$out"; exit "$status"`);
        assert.equal(result.exitCode, direct.exitCode, result.stderr);
        assert.equal(result.stdout, direct.stdout);
        assert.equal(result.stderr, direct.stderr.repeat(mode === "substitution" ? 1 : 2));
      } finally {
        await shell.dispose();
      }
    });
  }
}
