import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShell, ShellSyntaxError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";
import { printfCommand } from "../../src/commands/basic.js";
import { streamCommands } from "../../src/commands/streams.js";

for (const opening of ["((", "( ("]) test(`nested subshell file effects with ${opening}`, async () => {
  const { shell, fs } = setup({ cwd: "/work" });
  await fs.mkdir("/work");
  shell.register(printfCommand);
  shell.register(streamCommands().find(command => command.name === "cat")!);
  try {
    const result = await shell.exec(`${opening}printf inner > inner.txt); printf outer > outer.txt)\ncat inner.txt outer.txt`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "innerouter");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/inner.txt")), "inner");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/outer.txt")), "outer");
  } finally { await shell.dispose(); }
});

for (const [source, expected] of [
  ["((say inner) )", "inner\n"],
  ["(((say inner); say middle); say outer)", "inner\nmiddle\nouter\n"],
  ['value=parent; ((value=inner; say "$value"); value=outer; say "$value"); say "$value"', "inner\nouter\nparent\n"],
  ["f() { ((say inner); say outer); }; f", "inner\nouter\n"],
  ["((say inner); say outer) | pass", "inner\nouter\n"],
  ["((say inner); say outer) > /result; pass < /result", "inner\nouter\n"],
  ["((say '))'); say outer)", "))\nouter\n"],
  ['((say "(("); say outer)', "((\nouter\n"],
  ["((say \\( ); say outer)", "(\nouter\n"],
  ["((say $'\\x28'); say outer)", "(\nouter\n"],
  ["((say `say '('`); say outer)", "(\nouter\n"],
  ['((say "$(say "))")"); say outer)', "))\nouter\n"],
  ["((say $'\\'((('); say outer)", "'(((\nouter\n"],
  ['((say "\\"))"); say outer)', '"))\nouter\n'],
] as const) test(`adjacent subshell syntax: ${source}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

test("paired arithmetic delimiters retain expression effects and deferred failures", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('value=1; ((value += (2 * 3))); say "$value:$?"; ((value++)); say "$value:$?"; ((0)); say "$?"');
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "7:0\n8:0\n1\n");
    const invalid = await shell.exec("say before; ((say inner)); say after");
    assert.equal(invalid.stdout, "before\nafter\n");
    assert.equal(invalid.exitCode, 0);
    assert.ok(invalid.stderr.includes("arithmetic syntax error in expression"));
    const incomplete = await shell.exec("((1 +");
    assert.equal(incomplete.exitCode, 2);
    assert.equal(incomplete.stdout, "");
    assert.equal(incomplete.stderr, "shell: Unterminated arithmetic expression at offset 2\n");
  } finally { await shell.dispose(); }
});

test("non-shell whitespace remains literal and never stalls tokenization", { timeout: 1000 }, async () => {
  const { shell } = setup();
  for (const whitespace of ["\u00a0", "\v", "\r", "\f", "\u2028", "\u2029", "\ufeff"]) {
    assert.doesNotThrow(() => parseShell(`args a${whitespace}b`));
    assert.deepEqual(JSON.parse((await shell.exec(`args a${whitespace}b`)).stdout), [`a${whitespace}b`]);
  }
});

test("continuations preserve keyword, operator and descriptor recognition", async () => {
  const { shell, fs } = setup();
  assert.equal((await shell.exec("i\\\nf true; th\\\nen say yes; f\\\ni")).stdout, "yes\n");
  assert.equal((await shell.exec("true |\\\n| say no; false &\\\n& say no; say yes")).stdout, "yes\n");
  const result = await shell.exec("both 2\\\n>errors");
  assert.equal(result.stdout, "out\n");
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/errors")), "err\n");
  assert.equal((await shell.exec("args 'a\\\nb' \"c\\\nd\" e\\\nf")).stdout, '["a\\\\\\nb","cd","ef"]');
});

test("misplaced negation and unsupported expansion syntax reject before effects", async () => {
  for (const source of ["say touched; ! ! true", "say touched; true | ! false", "say touched; args $'unterminated", 'say touched; args $"text"', "say touched; args $$ $! $-"]) {
    const { shell } = setup();
    assert.throws(() => parseShell(source), ShellSyntaxError);
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 2, source);
    assert.equal(result.stdout, "", source);
  }
  assert.equal((await setup().shell.exec("args ! '$$' \\$!")).stdout, '["!","$$","$!"]');
  const arithmetic = await setup().shell.exec("say touched; args $((1 constructor 2))");
  assert.equal(arithmetic.exitCode, 1);
  assert.equal(arithmetic.stdout, "touched\n");
  assert.match(arithmetic.stderr, /arithmetic syntax error in expression/u);
});

test("parameter alternates inherit outer double-quote rules", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('args "${missing:-\'hello\'}" ${missing:-\'hello world\'}')).stdout, '["\'hello\'","hello world"]');
  assert.equal((await shell.exec('args "${missing:-a\'b\'c}" "${missing:-${other:-\'nested\'}}"')).stdout, '["a\'b\'c","\'nested\'"]');
});

const compoundCommands = [
  "(true)",
  "((1))",
  "{ true; }",
  "if true; then true; fi",
  "while false; do true; done",
  "until true; do true; done",
  "for item in once; do true; done",
  "fn() { true; }",
];

test("compound commands require separators before quoted and expanded words without effects", async () => {
  for (const compound of compoundCommands) {
    for (const word of ['"say"', "'say'", '""', "$COMMAND", '"$COMMAND"', "${COMMAND}", "$(say say)", "`say say`"]) {
      const { shell, fs, commands } = setup({ env: { COMMAND: "say" } });
      let calls = 0;
      commands.register({ name: "mark", execute() { calls++; return { exitCode: 0 }; } });
      const source = `mark > /effect; ${compound} ${word} nope`;
      assert.throws(() => parseShell(source), ShellSyntaxError, source);
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 2, source);
      assert.equal(result.stdout, "", source);
      assert.match(result.stderr, /Expected command separator/u, source);
      assert.equal(calls, 0, source);
      await assert.rejects(() => fs.stat("/effect"), { code: "ENOENT" }, source);
    }
  }
});

test("missing compound separators reject recursively in skipped branches and functions", async () => {
  for (const invalid of ['(true) "say" nope', "((1)) $COMMAND nope"]) {
    for (const nested of [`false && { ${invalid}; }`, `fn() { ${invalid}; }`, `args $(${invalid})`]) {
      const { shell, fs } = setup({ env: { COMMAND: "say" } });
      const source = `say touched; say touched > /effect; ${nested}`;
      assert.throws(() => parseShell(source), ShellSyntaxError, source);
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 2, source);
      assert.equal(result.stdout, "", source);
      await assert.rejects(() => fs.stat("/effect"), { code: "ENOENT" }, source);
    }
  }
});

test("compound commands still accept separators, list operators, closing parentheses and EOF", async () => {
  for (const compound of compoundCommands) {
    assert.doesNotThrow(() => parseShell(compound), compound);
    assert.doesNotThrow(() => parseShell(`(${compound})`), compound);
    for (const separator of [";", "\n", "&&", "|"]) {
      const source = `${compound} ${separator} "say" yes`;
      const result = await setup().shell.exec(source);
      assert.equal(result.exitCode, 0, source);
      assert.equal(result.stdout, "yes\n", source);
    }
    const source = `${compound} || "say" no`;
    const result = await setup().shell.exec(source);
    assert.equal(result.exitCode, 0, source);
    assert.equal(result.stdout, "", source);
  }
});
