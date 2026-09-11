import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { getCommandArguments } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/types.js";

for (const [label, source, stdin, expected] of [
  ["default destination", 'mapfile; args "${MAPFILE[@]}"', "a\nb\n", '["a\\n","b\\n"]'],
  ["strip delimiter", 'mapfile -t A; args "${A[@]}"', "a\nb", '["a","b"]'],
  ["alias", 'readarray -t A; args "${A[@]}"', "a\n", '["a"]'],
  ["count", 'mapfile -t -n 1 A; args "${A[@]}"; pass', "a\nb\n", '["a"]b\n'],
  ["skip", 'mapfile -t -s 1 -n 1 A; args "${A[@]}"; pass', "a\nb\nc\n", '["b"]c\n'],
  ["origin", 'A=(old keep tail); mapfile -t -O 1 A; args "${A[@]}"', "new\n", '["old","new","tail"]'],
  ["empty clears", 'A=(old); mapfile A; args "${A[@]}"', "", '[]'],
  ["custom delimiter", 'mapfile -t -d : A; args "${A[@]}"', "a:b:", '["a","b"]'],
  ["NUL truncates record", 'mapfile A; args "${A[@]}"', "a\0b\nc\n", '["a","c\\n"]'],
  ["NUL delimiter", 'mapfile -d "" A; args "${A[@]}"', "a\0b\0c", '["a","b","c"]'],
  ["callbacks", 'cb() { say "$1:$2:${#A[@]}"; return 7; }; mapfile -t -C cb -c 2 A; args "${A[@]}"', "a\nb\nc\nd\n", '1:b:1\n3:d:3\n["a","b","c","d"]'],
  ["callback consumes input", 'cb() { read skipped; }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\nc\nd\n", '["a","c"]'],
  ["callback replaces contents", 'cb() { A=(changed); }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '["changed","b"]'],
  ["callback unsets target", 'cb() { unset A; }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '[]'],
  ["callback recreates target", 'cb() { unset A; A=(new); }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '["new"]'],
  ["callback freezes admitted target", 'cb() { readonly A; }; mapfile -t -C cb -c 1 A; args "${A[@]}"', "a\nb\n", '["a","b"]'],
  ["callback script prefix", 'cb() { say "$1:$2"; }; mapfile -t -C "say prefix; cb" -c 1 A', "a\n", 'prefix\n0:a\n'],
  ["callback prefix comment", 'mapfile -t -C "say prefix # comment" -c 1 A; args "${A[@]}"', "a\n", 'prefix\n["a"]'],
  ["callback origin and skip", 'cb() { say "$1:$2"; }; mapfile -t -O 5 -s 1 -C cb -c 2 A; args "${A[5]}" "${A[6]}"', "skip\na\nb\n", '6:b\n["a","b"]'],
] as const) test(`mapfile: ${label}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source, { stdin });
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
  } finally { await shell.dispose(); }
});

for (const callback of ["return 7", "exit 7"]) test(`mapfile callback control retains errexit: ${callback}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`set -e; cb() { ${callback}; }; mapfile -t -C cb -c 1 A; say WRONG`, { stdin: "a\n" });
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});

test("mapfile readonly and invalid options refuse before pulling input", async () => {
  for (const source of ['A=(old); readonly A; mapfile A', 'mapfile -c 0 A', 'mapfile -n -1 A', 'mapfile -O nope A']) {
    const { shell } = setup();
    let pulls = 0;
    const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(97, 10); } };
    try {
      assert.equal((await shell.exec(source, { stdin })).exitCode, 1);
      assert.equal(pulls, 0);
    } finally { await shell.dispose(); }
  }
});

test("mapfile default callback quantum is 5000", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('cb() { say "$1:${#A[@]}"; }; mapfile -t -C cb A; say "${#A[@]}"', { stdin: "x\n".repeat(5001) });
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "4999:4999\n5001\n");
  } finally { await shell.dispose(); }
});

test("mapfile input records cannot execute callback-source syntax", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('cb() { args "$2"; }; mapfile -t -C cb -c 1 A', { stdin: "$(say WRONG); 'quoted'\n" });
    assert.equal(result.stdout, JSON.stringify(["$(say WRONG); 'quoted'"]));
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const [limits, limit] of [
  [{ maxLoopIterations: 1 }, "maxLoopIterations"],
  [{ maxOutputBytes: 1 }, "maxOutputBytes"],
] as const) test(`mapfile preserves ${limit}`, async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec('mapfile -t A', { stdin: "a\nb\n", limits }), error => error instanceof ShellLimitError && error.limit === limit);
  } finally { await shell.dispose(); }
});

for (const source of [
  'mapfile -t A; raw "${A[@]}" "${A[0]}" "$A"',
  'mapfile -t A; B=("${A[@]}"); raw "${B[@]}" "${A[0]}" "$A"',
  'mapfile -t A; (A[0]=changed); raw "${A[@]}" "${A[0]}" "$A"',
]) test(`mapfile raw values survive expansion and copying: ${source}`, async () => {
  const { shell } = setup();
  shell.register({ name: "raw", async execute(context) {
    const args = getCommandArguments(context);
    for (let index = 0; index < args.values.length; index++) await context.stdout.write(args.bytes(index)!);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec(source, { stdin: Uint8Array.of(255, 10) });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 255, 255));
  } finally { await shell.dispose(); }
});

test("mapfile raw element zero survives scalar-style append", async () => {
  const { shell } = setup();
  shell.register({ name: "raw", async execute(context) { await context.stdout.write(getCommandArguments(context).bytes(0)!); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('mapfile -t A; A+=z; raw "$A"', { stdin: Uint8Array.of(255, 10) });
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 122));
  } finally { await shell.dispose(); }
});

test("mapfile callback source inherits caller loop flow", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('for x in 1 2; do mapfile -t -C "break; :" -c1 A; say WRONG; done; say end', { stdin: "a\nb\n" });
    assert.equal(result.stdout, "end\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const count of ['-0', ' +2 ', '2 ', ' 2']) test(`mapfile accepts decimal count ${JSON.stringify(count)}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`mapfile -t -n '${count}' A; args "${'${A[@]}'}"`, { stdin: 'a\nb\n' });
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '["a","b"]');
  } finally { await shell.dispose(); }
});

test('mapfile defers direct callback flow while retaining every record', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('for x in 1 2; do mapfile -t -C "say callback; break; :" -c 1 A; say WRONG; done; args "${A[@]}"; pass', { stdin: 'a\nb\n' });
    assert.equal(result.stdout, 'callback\n["a","b"]');
    assert.equal(result.stderr, '');
  } finally { await shell.dispose(); }
});

test('mapfile function callback retains its own loop scope', async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('cb() { say callback; break; }; for x in 1 2; do mapfile -t -C cb -c 1 A; say after; done', { stdin: 'a\nb\n' });
    assert.equal(result.stdout, 'callback\ncallback\nafter\nafter\n');
    assert.match(result.stderr, /break: only meaningful in a loop/u);
  } finally { await shell.dispose(); }
});

test('mapfile admits cumulative input before retaining records or running later effects', async () => {
  for (const streaming of [false, true]) {
    const { shell } = setup();
    let effects = 0;
    shell.register({ name: 'effect', execute() { effects++; return { exitCode: 0 }; } });
    const stdin = streaming ? { async *[Symbol.asyncIterator]() { yield Uint8Array.of(97, 10); yield Uint8Array.of(98, 10); } } : 'abc\n';
    try {
      await assert.rejects(shell.exec('mapfile -t A; effect', { stdin, limits: { maxInputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === 'maxInputBytes');
      assert.equal(effects, 0);
      assert.equal((await shell.exec('effect')).exitCode, 0);
      assert.equal(effects, 1);
    } finally { await shell.dispose(); }
  }
});
