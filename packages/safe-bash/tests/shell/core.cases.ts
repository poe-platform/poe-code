import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShell, ShellSyntaxError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

test("quotes, escaped syntax, comments and empty arguments", async () => {
  const { shell } = setup({ env: { VALUE: "two words *" } });
  const result = await shell.exec("args '' \"$VALUE\" '$VALUE' a\\ b \\* foo#bar # ignored\n");
  assert.equal(result.stdout, '["","two words *","$VALUE","a b","*","foo#bar"]');
  assert.equal(result.exitCode, 0);
  assert.equal((await shell.exec("# hi\n\n")).stdout, "");
});

test("splitting expands only unquoted substitutions and joins adjacent parts", async () => {
  const { shell } = setup({ env: { VALUE: " a b ", EMPTY: "" } });
  assert.equal((await shell.exec('args x${VALUE}y "$EMPTY" $EMPTY')).stdout, '["x","a","b","y",""]');
  assert.equal((await shell.exec('args "x${VALUE}y"')).stdout, '["x a b y"]');
  assert.equal((await shell.exec('args one\\\ntwo "one\\\ntwo"')).stdout, '["onetwo","onetwo"]');
});

for (const [name, separators, value, expected] of [
  ["whitespace", " \t\n", " \ta  b\n", ["a", "b"]],
  ["nonwhitespace empty fields", ":", ":a::b:", ["", "a", "", "b"]],
  ["mixed separators", " :", " : a:: b : ", ["", "a", "", "b"]],
  ["BMP separator", "é", "aééb", ["a", "", "b"]],
  ["astral separator", "🙂", "a🙂🙂b", ["a", "", "b"]],
  ["astral chunk boundary", " ", `${"a".repeat(4095)}🙂 b`, [`${"a".repeat(4095)}🙂`, "b"]],
  ["empty IFS", "", " a b ", [" a b "]],
] as const) {
  test(`IFS run semantics: ${name}`, async () => {
    const { shell } = setup({ env: { IFS: separators, value } });
    const result = await shell.exec("args $value");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
    await shell.dispose();
  });
}

test("IFS runs retain quoted glob boundaries and array member boundaries", async () => {
  const { shell, fs } = setup({ env: { value: "x y", tail: "*" } });
  for (const name of ["/*x", "/prefixy", "/y*", "/yz"]) await fs.writeFile(name, new Uint8Array());
  assert.equal((await shell.exec('args "*"${value}"*"')).stdout, '["*x","y*"]');
  assert.equal((await shell.exec('args "*"${value}${tail}')).stdout, '["*x","y*","yz"]');
  assert.equal((await shell.exec('values=(" a b " "c d" ""); args ${values[@]}')).stdout, '["a","b","c","d"]');
  assert.equal((await shell.exec('values=(" a b " "c d" ""); args "${values[@]}"')).stdout, '[" a b ","c d",""]');
  assert.equal((await shell.exec('IFS=:; values=("a::b" ":c:"); args ${values[@]}')).stdout, '["a","","b","","c"]');
  await shell.dispose();
});

test("IFS run checkpoints do not consume the command limit", async () => {
  const { shell } = setup({ env: { value: "a".repeat(16384) } });
  const result = await shell.exec("args $value", { limits: { maxCommands: 1 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["a".repeat(16384)]);
  await shell.dispose();
});

test("variables, defaults, assignments, export and unset", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('VALUE="hello world"; args "$VALUE" ${MISSING:-fallback} "${VALUE:+yes}"')).stdout, '["hello world","fallback","yes"]');
  assert.equal((await shell.exec('VALUE=local; envget VALUE; export VALUE; envget VALUE; VALUE=temp envget VALUE; envget VALUE')).stdout, "<unset>localtemplocal");
  assert.equal((await shell.exec('args "${MISSING:=set}" "$MISSING" "${#MISSING}"; unset MISSING; args "${MISSING-no}"')).stdout, '["set","set","3"]["no"]');
  assert.equal((await shell.exec('VALUE=old; VALUE=new args "$VALUE"; args "$VALUE"')).stdout, '["old"]["old"]');
});

test("status, negation, and-or lists are left associative", async () => {
  const { shell } = setup();
  const result = await shell.exec('false && say no || say yes; true || say no && say after; ! true; say "$?"; status 17');
  assert.equal(result.stdout, "yes\nafter\n1\n");
  assert.equal(result.exitCode, 17);
  assert.equal((await shell.exec("false | true")).exitCode, 0);
  assert.equal((await shell.exec("true | false")).exitCode, 1);
  assert.equal((await shell.exec("! true | false")).exitCode, 0);
});

test("command substitution handles nested syntax and removes only trailing newlines", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('args "$(say "$(say inner)")" $(say "a b") `say legacy`')).stdout, '["inner","a","b","legacy"]');
  assert.equal((await shell.exec('VALUE=$(say one; say ""); args "$VALUE"')).stdout, '["one"]');
  assert.equal((await shell.exec('VALUE=$(status 7); say "$?"')).stdout, "7\n");
  assert.equal((await shell.exec('say "$(err warning; say ok)"')).stderr, "warning\n");
});

test("parse whole script including substitutions before any command or redirect", async () => {
  for (const script of [
    "say ran; say 'unterminated", "say ran > touched; true &&",
    "say ran; if true; then say no", "say ran; (true", "say ran; say ${bad", "say ran; true & false",
    "say ran; say $(say 'bad)", "say ran; say >", "say ran; case a in a) true;;",
    "say ran; say <<\nhello\nEOF",
  ]) {
    const { shell, fs } = setup();
    assert.throws(() => parseShell(script), ShellSyntaxError, script);
    const result = await shell.exec(script);
    assert.equal(result.exitCode, 2, script);
    assert.equal(result.stdout, "", script);
    await assert.rejects(fs.stat("/touched"));
  }
  const nested = await setup().shell.exec("say ran; say $(true &&)");
  assert.equal(nested.exitCode, 127);
  assert.equal(nested.stdout, "");
  const arithmetic = await setup().shell.exec("say ran; say $((1 + ))");
  assert.equal(arithmetic.exitCode, 1);
  assert.equal(arithmetic.stdout, "ran\n");
});

test("redirects truncate, append, consume stdin and preserve byte data", async () => {
  const { shell, fs } = setup();
  assert.equal((await shell.exec("say first > file; say second >> file; pass < file")).stdout, "first\nsecond\n");
  await shell.exec("bytes > binary");
  assert.deepEqual([...await fs.readFile("/binary")], [0, 255, 195, 169, 128, 10]);
  assert.deepEqual([...(await shell.exec("pass < binary")).stdoutBytes], [0, 255, 195, 169, 128, 10]);
  await shell.exec("false > file");
  assert.equal((await fs.readFile("/file")).length, 0);
});

test("descriptor duplicates are snapshots applied left to right", async () => {
  const { shell, fs } = setup();
  const together = await shell.exec("both > first 2>&1");
  assert.equal(together.stdout + together.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/first")), "out\nerr\n");
  const separate = await shell.exec("both 2>&1 > second");
  assert.equal(separate.stdout, "err\n");
  assert.equal(separate.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/second")), "out\n");
  assert.equal((await shell.exec("both 3>&1 1>&2 2>&3")).stdout, "err\n");
  assert.equal((await shell.exec("say 2 > spaced")).stdout, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/spaced")), "2\n");
});

test("cwd, environment and pipeline state isolate across executions", async () => {
  const { shell, fs } = setup({ env: { HOME: "/home", VALUE: "original" } });
  await fs.mkdir("/home");
  assert.equal((await shell.exec('cd; pwd; VALUE=changed; (cd /; VALUE=child; pwd); pwd; say "$VALUE"')).stdout, "/home\n/\n/home\nchanged\n");
  assert.equal((await shell.exec('cd /home | pass; pwd; say "$VALUE"')).stdout, "/\noriginal\n");
  assert.equal((await shell.exec('VALUE=changed; say "$(VALUE=child; say "$VALUE")"; say "$VALUE"')).stdout, "child\nchanged\n");
  assert.equal((await shell.exec("pwd", { cwd: "/home" })).stdout, "/home\n");
  assert.equal((await shell.exec("pwd")).stdout, "/\n");
});

test("if, elif, loops, break and continue", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec("if false; then say no; elif true; then say yes; else say no; fi")).stdout, "yes\n");
  assert.equal((await shell.exec('for name in first "two words"; do say "$name"; done')).stdout, "first\ntwo words\n");
  assert.equal((await shell.exec('while true; do say once; break; say never; done; until true; do say never; done')).stdout, "once\n");
  assert.equal((await shell.exec('for name in a b; do say "$name"; continue; say never; done')).stdout, "a\nb\n");
  assert.equal((await shell.exec('for outer in a b; do for inner in c d; do say "$outer$inner"; break 2; done; done')).stdout, "ac\n");
});

test("functions, positional arguments, groups, returns and exits", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('greet() { args "$@" "$#" "$1"; return 7; say never; }; greet one "two words"; say "$?"')).stdout, '["one","two words","2","one"]7\n');
  assert.equal((await shell.exec('collect() { for value; do say "$value"; done; }; collect one two')).stdout, "one\ntwo\n");
  assert.equal((await shell.exec('empty() { args "$@"; }; empty')).stdout, "[]");
  assert.equal((await shell.exec('{ VALUE=group; }; say "$VALUE"')).stdout, "group\n");
  assert.equal((await shell.exec('say before; exit -1; say never')).exitCode, 255);
  assert.equal((await shell.exec('(exit 9); say "$?"')).stdout, "9\n");
});

test("pathname expansion respects quotes, hidden entries and missing patterns", async () => {
  const { shell, fs } = setup({ env: { HOME: "/home" } });
  for (const file of ["/a.txt", "/b.txt", "/.hidden.txt"]) await fs.writeFile(file, new Uint8Array());
  assert.equal((await shell.exec('args *.txt "*.txt" z* [ab].txt')).stdout, '["a.txt","b.txt","*.txt","z*","a.txt","b.txt"]');
  assert.equal((await shell.exec('args ~ ~/file "~"')).stdout, '["/home","/home/file","~"]');
});

test("missing commands and invalid statuses are diagnosed", async () => {
  const { shell } = setup();
  const missing = await shell.exec("missing-command");
  assert.equal(missing.exitCode, 127);
  assert.match(missing.stderr, /command not found/u);
  assert.equal((await shell.exec("status 999")).exitCode, 1);
  assert.equal((await shell.exec("args 1>&9")).exitCode, 1);
});
