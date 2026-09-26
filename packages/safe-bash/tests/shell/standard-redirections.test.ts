import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/commands/index.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import type { CommandContext } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

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
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs }).use(standardCommands()).use(textProgramCommands());
      t.after(() => shell.dispose());
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

for (const name of ["fd-writer", "wc"]) {
  for (const grouped of [false, true]) {
    test(`redirected ${name} shares direct and admitted stdout, grouped=${grouped}`, async t => {
      const fs = new MemoryFileSystem();
      const shell = new Shell({ fs });
      t.after(() => shell.dispose());
      let admission: CommandContext["admittedHandles"];
      shell.register({ name, async execute(context) {
        await context.stdout.write(new TextEncoder().encode("direct\n"));
        admission = context.admittedHandles;
        assert.ok(admission);
        const lease = await admission.acquire(1, ["write"], context.signal);
        try { await lease.write!(new TextEncoder().encode("lease\n"), context.signal); }
        finally { await lease.close(); }
        return { exitCode: 0 };
      } });
      const command = `${name} > /out`;
      const result = await shell.exec(grouped ? `{ ${command}; }` : command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "direct\nlease\n");
      assert.ok(admission);
      await assert.rejects(admission.acquire(1, ["write"], new AbortController().signal), { code: "EBADF" });
    });
  }
}

test("middleware around a stock command observes the redirected descriptor", async t => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs }).use(standardCommands());
  t.after(() => shell.dispose());
  shell.use(async (context, next) => {
    if (context.command === "wc") {
      await context.stdout.write(new TextEncoder().encode("direct\n"));
      assert.ok(context.admittedHandles);
      const lease = await context.admittedHandles.acquire(1, ["write"], context.signal);
      try { await lease.write!(new TextEncoder().encode("lease\n"), context.signal); }
      finally { await lease.close(); }
    }
    return next();
  });
  const result = await shell.exec("{ wc -c > /out; }", { stdin: "four" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "direct\nlease\n4\n");
});

for (const name of ["fd-writer", "sed"]) {
  for (const operator of [">", ">>"]) {
    test(`redirected ${name} ${operator} retains admitted file identity and retires leases`, async t => {
      const { shell, fs } = setup();
      t.after(() => shell.dispose());
      await fs.writeFile("/out", new TextEncoder().encode("before\n"));
      const original = await fs.stat("/out");
      let retainedStat: (() => Promise<unknown>) | undefined;
      shell.register({ name, async execute(context) {
        assert.ok(context.admittedHandles);
        const first = await context.admittedHandles.acquire(1, ["write", "stat"], context.signal);
        const second = await context.admittedHandles.acquire(1, ["write", "stat"], context.signal);
        retainedStat = () => first.stat!(new AbortController().signal);
        assert.equal(first.identity, second.identity);
        const opened = await first.stat!(context.signal);
        assert.equal(opened.ino, original.ino);
        assert.equal(opened.size, operator === ">>" ? 7 : 0);
        await context.fs.rename("/out", "/moved");
        await context.fs.writeFile("/out", new TextEncoder().encode("replacement\n"));
        await context.stdout.write(new TextEncoder().encode("direct\n"));
        await first.write!(new TextEncoder().encode("lease\n"), context.signal);
        await second.close();
        await first.write!(new TextEncoder().encode("after\n"), context.signal);
        const moved = await first.stat!(context.signal);
        assert.equal(moved.ino, original.ino);
        assert.equal(moved.size, operator === ">>" ? 26 : 19);
        // Keep one lease open: command cleanup must retire it without a caller close.
        return { exitCode: 0 };
      } });
      const result = await shell.exec(`{ ${name} ${operator} /out; }`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/moved")), `${operator === ">>" ? "before\n" : ""}direct\nlease\nafter\n`);
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "replacement\n");
      assert.ok(retainedStat);
      await assert.rejects(retainedStat(), { code: "EBADF" });
    });
  }
}

for (const name of ["fd-writer", "wc"]) for (const registration of ["shell", "registry", "plugin"]) {
  test(`redirected ${name} finalizes a caught file-write failure via ${registration}`, async t => {
    const fs = new MemoryFileSystem({ maxFileBytes: 3 });
    const shell = new Shell({ fs });
    t.after(() => shell.dispose());
    let rejected = false;
    const command = { name, async execute(context: CommandContext) {
      try { await context.stdout.write(new Uint8Array(4)); }
      catch (error) {
        assert.equal((error as { code?: string }).code, "EFBIG");
        rejected = true;
      }
      return { exitCode: 0 };
    } };
    if (registration === "shell") shell.register(command);
    else if (registration === "registry") shell.commands.register(command);
    else shell.use({ name: "registered-output", setup(host) { host.commands.register(command); } });
    const result = await shell.exec(`${name} > /out`);
    assert.equal(rejected, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /[Ff]ile too large/u);
    assert.equal((await fs.stat("/out")).size, 0);
  });
}
