import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";

for (const [name, source, expected] of [
  ["implicit both output", 'both >& out; pass < out', 'out\nerr\n'],
  ["append both output", 'say first > out; both &>> out; pass < out', 'first\nout\nerr\n'],
  ["readwrite input", 'say data > out; pass <> out', 'data\n'],
  ["readwrite creates", '{ say data >&3; } 3<> out; pass < out', 'data\n'],
  ["readwrite preserves tail", 'say abcdef > out; { say xy >&3; } 3<> out; pass < out', 'xy\ndef\n'],
  ["shared readwrite position", 'say abcdef > out; { say xy >&3; pass <&3; } 3<> out', 'def\n'],
  ["numeric duplication", 'say out 3> out >&3; pass < out', 'out\n'],
  ["array prefix restores after failure", 'a=(10 20); a=override status 7; say "${a[@]}"', '10 20\n'],
  ["array prefix nested function", 'a=(10 20); f(){ envget a; }; a=override f; say "${a[@]}"', 'override10 20\n'],
  ["array prefix", 'a=(10 20); a=override envget a; say "${a[@]}"', 'override10 20\n'],
  ["bare array arithmetic", 'a=(10 20); say "$((a+5))"; say "$((a=5)):${a[@]}"', '15\n5:5 20\n'],
] as const) test(`standard shell: ${name}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const source of ['say wrong 1>& out', 'say wrong >&9', 'say wrong 2>& out']) {
  test(`standard shell rejects invalid descriptor: ${source}`, async () => {
    const { shell } = setup();
    try {
      const result = await shell.exec(source);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("Bad file descriptor"), result.stderr);
    } finally { await shell.dispose(); }
  });
}

test("readwrite redirection drains short descriptor writes", async () => {
  const { shell, fs } = setup();
  const open = fs.open.bind(fs);
  fs.open = async (path, options) => {
    const descriptor = await open(path, options);
    const write = descriptor.write.bind(descriptor);
    descriptor.write = (bytes, position, forwarded) => write(bytes.subarray(0, 2), position, forwarded);
    return descriptor;
  };
  try {
    const result = await shell.exec('{ say abcdef >&3; } 3<> out; pass < out');
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "abcdef\n");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const extraRedirect of ["", " 2>/dev/null"]) {
  for (const [source, expected] of [
    ['sed -e "w /out" -e "s/longer-first-line/short/" /input', "short\n-first-line\n"],
    ['awk \'{ print "from-file-longer-text" >> "/out"; print "short" }\' /input', "short\nile-longer-text\n"],
  ]) {
    test(`output redirect preserves trailing bytes written independently: ${source}${extraRedirect}`, async t => {
      const { shell, fs } = setup();
      t.after(() => shell.dispose());
      shell.use(standardCommands()).use(textProgramCommands());
      await fs.writeFile("/input", new TextEncoder().encode("longer-first-line\n"));
      const result = await shell.exec(`${source} > /out${extraRedirect}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), expected);
    });
  }
}

for (const operator of [">", ">>"]) {
  test(`output redirect ${operator} retains its opened file after a rename`, async t => {
    const { shell, fs, commands } = setup();
    t.after(() => shell.dispose());
    await fs.writeFile("/out", new TextEncoder().encode("before\n"));
    commands.register({ name: "sed", async execute(context) {
      await context.fs.rename("/out", "/moved");
      await context.fs.writeFile("/out", new TextEncoder().encode("replacement\n"));
      await context.stdout.write(new TextEncoder().encode("after\n"));
      return { exitCode: 0 };
    } });
    const result = await shell.exec(`sed ${operator} /out`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/moved")), operator === ">>" ? "before\nafter\n" : "after\n");
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "replacement\n");
  });
}
