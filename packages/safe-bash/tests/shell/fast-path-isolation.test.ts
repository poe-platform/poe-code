import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { Shell } from "../../src/shell/shell.js";
import { standardCommands } from "../../src/commands/index.js";
import { Capture } from "../../src/shell/runtime.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

for (const [pipeline, expected] of [
  [String.raw`printf 'abc\n123\n' | grep -E '[[:digit:]]+'`, "123"],
  [String.raw`printf '123\nabc\n' | grep -E '[[:alpha:]]+'`, "abc"],
  [String.raw`printf '1e5\n2\nInfinity\n1\nNaN\n' | sort -n`, "Infinity\nNaN\n1\n1e5\n2"],
  [String.raw`printf '1e5\n2\nInfinity\n1\n' | sort -nu`, "Infinity\n1e5\n2"],
  [String.raw`printf '  a   b  \n\ta\tb\t\n' | awk -F ' ' '{print $1, $2}'`, "a b\na b"],
] as const) test(`pure substitution matches normal execution: ${pipeline}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()).use(textProgramCommands());
  context.after(() => shell.dispose());
  const direct = await shell.exec(pipeline);
  assert.equal(direct.stdout, expected + "\n");
  const substitution = await shell.exec(`echo "$(${pipeline})"`);
  assert.equal(substitution.stdout, direct.stdout);
  assert.equal(substitution.exitCode, 0);
});

for (const limits of [{ maxCommands: 3 }, { maxOutputBytes: 80 }]) test(`pure substitution bailout charges only fallback: ${JSON.stringify(limits)}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(String.raw`echo "$(printf 'abcdefghijklmnopqrst\n' | grep -E '[')"`);
  assert.equal(result.stdout, "\n");
  assert.match(result.stderr, /grep:/);
});

test("later-stage bailout restores intermediate charges", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxCommands: 4, maxOutputBytes: 110 } }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(String.raw`echo "$(printf 'abcdefghijklmnopqrst\n' | head -n 1 | grep -E '[')"`);
  assert.equal(result.stdout, "\n");
  assert.match(result.stderr, /grep:/);
});

test("pipeline stages execute once even when their result is asynchronous", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  await shell.exec("");
  let calls = 0;
  shell.commands.register({ name: "grep", async execute(context) {
    calls++;
    await Promise.resolve();
    await context.stdout.write(new TextEncoder().encode("match\n"));
    return { exitCode: 0 };
  } }, { replace: true });
  const result = await shell.exec("grep | wc -l");
  assert.equal(result.stdout, "1\n");
  assert.equal(calls, 1);
});

for (const flag of ["-l", "-c"]) test(`wc ${flag} charges synchronous input`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/file", new Uint8Array());
  const shell = new Shell({ fs, limits: { maxInputBytes: 1 } }).use(standardCommands());
  await assert.rejects(shell.exec(`find /dir | wc ${flag}`), /maxInputBytes/);
});

test("capture snapshots own their scratch bytes", () => {
  const capture = new Capture();
  capture.resetEmpty();
  capture.enableScratchBuffer();
  capture.write(new TextEncoder().encode("before"));
  const bytes = capture.takeBytes();
  capture.write(new TextEncoder().encode("after!"));
  assert.equal(new TextDecoder().decode(bytes), "before");
});

test("scratch capture works without global Buffer", () => {
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined!;
    const capture = new Capture();
    capture.resetEmpty();
    capture.enableScratchBuffer();
    capture.write(new TextEncoder().encode("x".repeat(100)));
    assert.equal(capture.takeUtf8Output(), "x".repeat(100));
  } finally { globalThis.Buffer = original; }
});

for (const command of [
  "grep -i hello /dir/a.txt | wc -l",
  "find /dir -type f | wc -l",
  "find /dir -delete | wc -l",
  "sort -o /sorted /dir/a.txt | wc -l",
]) test(`asynchronous pipeline completes cleanly: ${command}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/a.txt", new TextEncoder().encode("HELLO\nworld\n"));
  const shell = new Shell({ fs }).use(standardCommands());
  const result = await shell.exec(command);
  assert.equal(result.exitCode, 0, result.stderr);
  if (command.startsWith("grep")) assert.equal(result.stdout, "1\n");
  if (command.startsWith("sort")) assert.equal(new TextDecoder().decode(await fs.readFile("/sorted")), "HELLO\nworld\n");
});

test("shell source admission works without global Buffer", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined!;
    const result = await shell.exec("");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
  } finally { globalThis.Buffer = original; }
});

for (const [header, setup] of [
  ['while [[ -z $called ]]', 'unset called'],
  ['until [[ -n $called ]]', 'unset called'],
  ['for i in 1 2', ''],
  ['for ((i=0;i<2;i++))', ''],
] as const) {
  test(`sync loop resumes function and restores its frame: ${header}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`
      printf -v big '%9000s' a
      set -- topA topB
      f() { local lv=local; echo "pre:$1:$lv"; x=$(echo "$big" | grep a); echo "post:$1:$lv"; }
      ${setup}
      { ${header}; do called=1; echo "iter:$i"; f argA argB; echo "tail:$i"; done; }
      echo "global:$1:$2:$lv:\${FUNCNAME[*]}"
      f again
      echo "final:$1:$2:$lv:\${FUNCNAME[*]}"
    `);
    const indices = header.startsWith('for i') ? ['1', '2'] : header.startsWith('for ((') ? ['0', '1'] : [''];
    assert.equal(result.stderr, '');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, indices.map(i => `iter:${i}\npre:argA:local\npost:argA:local\ntail:${i}\n`).join('') +
      'global:topA:topB::\npre:again:local\npost:again:local\nfinal:topA:topB::\n');
  });
}

for (const [name, source] of [
  ['condition cursor', 'i=0; c=0; while ((c+=1)); x=$(echo "$big" | grep a); ((i<2)); do echo "$i:$c"; ((i+=1)); done; echo "end:$i:$c"'],
  ['until condition cursor', 'i=0; c=0; until ((c+=1)); x=$(echo "$big" | grep a); ((i>=2)); do echo "$i:$c"; ((i+=1)); done; echo "end:$i:$c"'],
  ['frozen for list and changed induction value', 'items="a b"; for i in $items; do items=z; i=changed; echo prefix; x=$(echo "$big" | grep a); echo "$i"; done'],
  ['nested body cursor', 'for i in 1 2; do for j in a b; do echo "$i:$j"; x=$(echo "$big" | grep a); echo tail; done; echo outer; done'],
  ['continue after fallback', 'for ((i=0;i<2;i++)); do echo "$i"; x=$(echo "$big" | grep a); continue; echo wrong; done; echo "end:$i"'],
  ['break after fallback', 'for i in 1 2; do echo "$i"; x=$(echo "$big" | grep a); break; echo wrong; done'],
  ['arithmetic step fallback', 'step=1; for ((i=0;i<2;i+=step)); do echo "$i"; step="1+0"; done; echo "end:$i"'],
  ['arithmetic condition fallback', 'stop=2; for ((i=0;i<stop;i++)); do echo "$i"; stop="1+1"; done; echo "end:$i"'],
  ['arithmetic iteration handoff', 'count=0; for ((i=0;i<4100;i++)); do ((count+=1)); done; echo "$count:$i"'],
  ['while iteration handoff', 'i=0; count=0; while ((i++<4100)); do ((count+=1)); done; echo "$count:$i"'],
] as const) test(`sync loop handoff matches Bash: ${name}`, async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const script = `printf -v big '%9000s' a; { ${source}; }`;
  const expected = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8' });
  const result = await shell.exec(script);
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, expected);
});

for (const header of ['while ((i<1000))', 'for ((i=0;i<1000;))']) {
  test(`sync fallback keeps the loop iteration budget: ${header}`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxLoopIterations: 1000 } }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`printf -v big '%9000s' a; i=0; { ${header}; do ((i++)); if ((i==500)); then x=$(echo "$big" | grep a); fi; :; done; echo "$i"; }`);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '1000\n');
  });
}
