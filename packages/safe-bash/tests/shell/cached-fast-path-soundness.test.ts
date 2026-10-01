import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";
import { Runtime } from "../../src/shell/runtime.js";

test("parsed scripts are reused only within their owning shell", async context => {
  const first = new Shell({ fs: new MemoryFileSystem() });
  const second = new Shell({ fs: new MemoryFileSystem() });
  context.after(() => first.dispose());
  context.after(() => second.dispose());
  const run = context.mock.method(Runtime.prototype, "runUnit");
  const source = "tenant_private_value=3494";
  await first.exec(source);
  await first.exec(source);
  await second.exec(source);
  const scripts = run.mock.calls.map(call => call.arguments[0]);
  assert.equal(scripts[0], scripts[1]);
  assert.notEqual(scripts[0], scripts[2]);
});

test("default locale reaches speculative warm parsing", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  await shell.exec("");
  const snapshot = context.mock.method(ParseBudget.prototype, "snapshot");
  const result = await shell.exec("echo warm-byte-locale");
  assert.equal(result.stdout, "warm-byte-locale\n");
  assert.ok(snapshot.mock.callCount() > 0);
});

for (const source of [
  "echo cached-warm",
  "LC_ALL=C\necho $'\\u00e9'\nunset LC_ALL\necho $'\\u00e9'",
  "LC_ALL=C.UTF-8\necho $'\\u00e9'\nLC_ALL=POSIX\necho $'\\u00e9'",
  "echo before\necho 'unterminated",
]) {
  test(`warm and ordinary execution agree across cached runs: ${source}`, async context => {
    const ordinary = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    ordinary.use(async (_context, next) => next());
    const warm = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => ordinary.dispose());
    context.after(() => warm.dispose());
    const expected = await ordinary.exec(source);
    for (let run = 0; run < 2; run++) {
      await warm.exec("");
      const actual = await warm.exec(source);
      assert.deepEqual(actual.stdoutBytes, expected.stdoutBytes);
      assert.deepEqual(actual.stderrBytes, expected.stderrBytes);
      assert.equal(actual.exitCode, expected.exitCode);
    }
  });
}

test("each shell bounds its parsed source cache", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() });
  context.after(() => shell.dispose());
  const run = context.mock.method(Runtime.prototype, "runUnit");
  await shell.exec("bounded=first");
  const first = run.mock.calls[0]!.arguments[0];
  for (let index = 0; index < 64; index++) await shell.exec(`bounded=${index}`);
  await shell.exec("bounded=first");
  assert.notEqual(run.mock.calls.at(-1)!.arguments[0], first);
});

test("warm invocations own their promises and mutable result bytes", async context => {
  const shells = [new Shell({ fs: new MemoryFileSystem() }).use(standardCommands()),
    new Shell({ fs: new MemoryFileSystem() }).use(standardCommands())];
  for (const shell of shells) context.after(() => shell.dispose());
  for (const shell of shells) await shell.exec("");
  const first = shells[0]!.exec("echo isolated");
  const second = shells[1]!.exec("echo isolated");
  assert.notEqual(first, second);
  const [a, b] = await Promise.all([first, second]);
  assert.notEqual(a, b);
  a.stdoutBytes.fill(120);
  assert.equal(new TextDecoder().decode(b.stdoutBytes), "isolated\n");
  await shells[0]!.exec("");
  const next = await shells[0]!.exec("echo isolated");
  assert.equal(new TextDecoder().decode(next.stdoutBytes), "isolated\n");
});

for (const [name, source, env, expected] of [
  ["negative echo", "a=0; for i in {1..5}; do y=$((y - i)); done; echo $y", { y: "0" }, "-15\n"],
  ["unquoted whitespace", "a=0; for i in {1..5}; do y=$((y + i)); done; echo $msg", { y: "0", msg: "a   b" }, "a b\n"],
  ["IFS on cached runs", "a=0; for i in {1..5}; do y=$((y + 30)); done; echo $y", { y: "0", IFS: "5" }, "1 0\n"],
  ["failed integer admission preserves initial assignment", "a=0; for i in {1..5}; do y=$((y + a + i)); a=$((a + 1)); done; echo $y", { y: "1+2", a: "99" }, "28\n"],
] as const) {
  test(`cached script preserves ${name}`, async context => {
    const warm = new Shell({ fs: new MemoryFileSystem(), env: { y: "100" } }).use(standardCommands());
    const shell = new Shell({ fs: new MemoryFileSystem(), env }).use(standardCommands());
    context.after(() => warm.dispose());
    context.after(() => shell.dispose());
    for (let run = 0; run < 3; run++) await warm.exec(source);
    const assignments = Object.entries(env).map(([key, value]) => `${key}='${value}'; `).join("");
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", assignments + source], { encoding: "utf8" });
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal(oracle.stdout, expected);
    const result = await shell.exec(source);
    assert.equal(result.stdout, oracle.stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

test("cached script expands unquoted pathname patterns", async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/hello.txt", new Uint8Array());
  const shell = new Shell({ fs, cwd: "/work", env: { glob: "*.txt" } }).use(standardCommands());
  context.after(() => shell.dispose());
  const source = "acc=0; for i in {1..10}; do acc=$((acc + i)); done; echo $glob";
  for (let run = 0; run < 4; run++) {
    const result = await shell.exec(source);
    assert.equal(result.stdout, "hello.txt\n");
    assert.equal(result.exitCode, 0, result.stderr);
  }
});

test("cached script fallback for a large echo does not replay arithmetic", async context => {
  const source = "a=0; for i in {1..5}; do y=$((y + i)); done; echo $z\necho $y";
  const warm = new Shell({ fs: new MemoryFileSystem(), env: { y: "0", z: "short" } }).use(standardCommands());
  const z = "x".repeat(70000);
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { y: "0", z } }).use(standardCommands());
  context.after(() => warm.dispose());
  context.after(() => shell.dispose());
  for (let run = 0; run < 3; run++) await warm.exec(source);
  const result = await shell.exec(source);
  assert.equal(result.stdout, `${z}\n15\n`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

const batch = 'mkdir -p /tmp_dir\necho "first" > /keep/a\necho "second" > /tmp_dir/b\nrm -rf /tmp_dir';

for (const override of ["function", "command", "builtin"] as const) {
  test(`repeated function writes remain visible to an rm ${override}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const observed: string[] = [];
    const execute = async () => {
      observed.push(new TextDecoder().decode(await fs.readFile("/work/a")) + new TextDecoder().decode(await fs.readFile("/work/b")));
      return { exitCode: 0 };
    };
    const shell = new Shell({ fs, extensions: override === "builtin" ? [{
      name: "observe-rm", create: () => ({ builtins: [{ name: "rm", async execute() { await execute(); return 0; } }] })
    }] : [] }).use(standardCommands());
    context.after(() => shell.dispose());
    await shell.exec("");
    if (override === "command") shell.register({ name: "rm", execute }, { replace: true });
    const result = await shell.exec(`${override === "function" ? "rm() { cat /work/a /work/b; }" : ""}
      work() { echo first > /work/a; echo second > /work/b; rm -rf /work; }
      work; work; work`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    if (override === "function") assert.equal(result.stdout, "first\nsecond\n".repeat(3));
    else assert.deepEqual(observed, Array(3).fill("first\nsecond\n"));
  });
}

for (const failure of ["readonly directory", "readonly file", "directory target", "file parent"] as const) {
  for (const errexit of [false, true]) {
    test(`warmed writes preserve ${failure} with errexit=${errexit}`, async context => {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/work");
      const shell = new Shell({ fs }).use(standardCommands());
      context.after(() => shell.dispose());
      const session = shell.createSession();
      const warm = await session.exec('work() { echo first > /work/a; echo second > /work/b; rm -rf /work; echo survived; }; work; mkdir /work; work');
      assert.equal(warm.stderr, "");
      assert.equal(warm.exitCode, 0);
      await fs.mkdir("/work", { recursive: true });
      if (failure === "readonly directory") await fs.chmod("/work", 0o555);
      if (failure === "readonly file") {
        await fs.writeFile("/work/b", new TextEncoder().encode("original"));
        await fs.chmod("/work/b", 0o444);
      }
      if (failure === "directory target") await fs.mkdir("/work/b");
      if (failure === "file parent") {
        await fs.rmdir("/work");
        await fs.writeFile("/work", new Uint8Array());
      }
      const result = await session.exec(`${errexit ? "set -e; " : ""}work`);
      assert.equal(result.exitCode, errexit ? 1 : 0);
      assert.equal(result.stdout, errexit ? "" : "survived\n");
      assert.ok(result.stderr.includes(failure === "directory target" ? "Is a directory" : failure === "file parent" ? "Not a directory" : "Permission denied"), result.stderr);
      if (errexit) {
        await fs.lstat("/work");
        if (failure === "readonly file" || failure === "directory target") {
          assert.equal(new TextDecoder().decode(await fs.readFile("/work/a")), "first\n");
        }
      }
    });
  }
}

for (const target of ["file", "symlink", "overridden rm", "rm function"] as const) {
  test(`cached echo batch preserves effects with ${target}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/keep");
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(() => shell.dispose());
    for (let run = 0; run < 4; run++) { await shell.exec(""); await shell.exec(batch); }
    if (target === "file") await fs.writeFile("/tmp_dir", new TextEncoder().encode("file"));
    if (target === "symlink") {
      await fs.mkdir("/real");
      await fs.symlink("/real", "/tmp_dir");
    }
    let observed = "";
    if (target === "overridden rm") shell.register({ name: "rm", async execute() {
      observed = new TextDecoder().decode(await fs.readFile("/tmp_dir/b"));
      return { exitCode: 0 };
    } }, { replace: true });
    const session = shell.createSession();
    if (target === "rm function") await session.exec('rm() { cat /tmp_dir/b; }');
    await shell.exec("");
    const result = await (target === "rm function" ? session.exec(batch) : shell.exec(batch));
    assert.equal(result.exitCode, 0);
    if (target === "file") {
      assert.equal(result.stderr, "mkdir: EEXIST: file already exists, mkdir '/tmp_dir'\nshell: line 3: /tmp_dir/b: Not a directory\n");
      assert.match(result.stderr, /Not a directory/);
      await assert.rejects(fs.lstat("/tmp_dir"), { code: "ENOENT" });
    } else {
      assert.equal(result.stderr, "");
      if (target === "symlink") {
        await assert.rejects(fs.lstat("/tmp_dir"), { code: "ENOENT" });
        assert.equal(new TextDecoder().decode(await fs.readFile("/real/b")), "second\n");
      } else {
        assert.equal(new TextDecoder().decode(await fs.readFile("/tmp_dir/b")), "second\n");
        assert.equal(target === "overridden rm" ? observed : result.stdout, "second\n");
      }
    }
  });
}

for (const mutation of ["different filesystem", "middle entry", "nested directory"] as const) {
  test(`cached find count observes ${mutation}`, async context => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/sub", { recursive: true });
    for (let i = 0; i < 32; i++) await fs.writeFile(`/work/sub/f${String(i).padStart(2, "0")}.txt`, new Uint8Array());
    if (mutation === "nested directory") await fs.mkdir("/work/sub/nested");
    const shell = new Shell({ fs }).use(standardCommands());
    context.after(() => shell.dispose());
    const source = 'find /work/sub -name "*.txt" | wc -l';
    await shell.exec("");
    assert.equal((await shell.exec(source)).stdout.trim(), "32");
    if (mutation === "different filesystem") {
      const otherFs = new MemoryFileSystem();
      await otherFs.mkdir("/work/sub", { recursive: true });
      for (let i = 0; i < 32; i++) await otherFs.writeFile(`/work/sub/f${String(i).padStart(2, "0")}.${i === 0 || i === 31 ? "txt" : "md"}`, new Uint8Array());
      const other = new Shell({ fs: otherFs }).use(standardCommands());
      context.after(() => other.dispose());
      await other.exec("");
      assert.equal((await other.exec(source)).stdout.trim(), "2");
    } else {
      if (mutation === "middle entry") await fs.rename("/work/sub/f15.txt", "/work/sub/f15.md");
      else await fs.writeFile("/work/sub/nested/new.txt", new Uint8Array());
      await shell.exec("");
      assert.equal((await shell.exec(source)).stdout.trim(), mutation === "middle entry" ? "31" : "33");
    }
  });
}

for (const target of ["readonly target", "readonly parent", "failed write"] as const) {
  test(`warmed echo sequences preserve ${target} diagnostics and parse allowance`, async context => {
    const source = 'mkdir -p /work/a /work/b\necho first > /work/a/one\necho second > /work/a/two\necho removed > /work/b/file\nrm -rf /work/b';
    async function setup(ordinary: boolean) {
      const fs = new MemoryFileSystem();
      await fs.mkdir("/work/a", { recursive: true });
      const shell = new Shell({ fs }).use(standardCommands());
      if (ordinary) shell.use(async (_context, next) => next());
      context.after(() => shell.dispose());
      for (let run = 0; run < 4; run++) { await shell.exec(""); await shell.exec(source); }
      if (target === "readonly target") {
        await fs.mkdir("/work/b");
        await fs.chmod("/work/b", 0o555);
      } else if (target === "readonly parent") await fs.chmod("/work", 0o555);
      else await fs.chmod("/work/a/two", 0o444);
      await shell.exec("");
      return shell;
    }
    const ordinary = await setup(true);
    const shell = await setup(false);
    let admitted = 0;
    const admit = ParseBudget.prototype.admit;
    context.mock.method(ParseBudget.prototype, "admit", function (this: ParseBudget, units = 1) {
      admitted += units;
      return admit.call(this, units);
    });
    const expected = await ordinary.exec(source);
    const expectedUnits = admitted;
    assert.ok(expected.stderr.toLowerCase().includes("permission denied"));
    admitted = 0;
    const actual = await shell.exec(source);
    assert.equal(admitted, expectedUnits, "fallback must not charge parsed units twice");
    assert.equal(actual.stderr, expected.stderr);
    assert.equal(actual.exitCode, expected.exitCode);
    assert.equal(actual.stdout, expected.stdout);
  });
}

test("cached integer admission fallback preserves the finite parse allowance", async context => {
  const source = "a=0; for i in {1..5}; do y=$((y + z + i)); done; echo $y";
  const warm = new Shell({ fs: new MemoryFileSystem(), env: { y: "0", z: "1" } }).use(standardCommands());
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { y: "0", z: "1+2" } }).use(standardCommands());
  for (const item of [warm, shell]) context.after(() => item.dispose());
  for (let run = 0; run < 4; run++) await warm.exec(source);
  const result = await shell.exec(source, { limits: { maxParseUnits: 138 } });
  assert.equal(result.stdout, "30\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("cached integer loop respects exact and insufficient output budgets without replay", async context => {
  const source = "a=0; for i in {1..5}; do y=$((y + i)); done; echo $y";
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { y: "0" } }).use(standardCommands());
  context.after(() => shell.dispose());
  for (let run = 0; run < 4; run++) await shell.exec(source);
  const rejected = shell.createSession();
  await assert.rejects(rejected.exec(source, { limits: { maxOutputBytes: 2 } }),
    error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.equal((await rejected.exec('echo "$y"')).stdout, "0\n");
  const accepted = shell.createSession();
  const result = await accepted.exec(source, { limits: { maxOutputBytes: 3 } });
  assert.equal(result.stdout, "15\n");
  assert.equal(result.exitCode, 0);
});

for (const y of [undefined, "", "-0"]) {
  for (const echoVar of ["acc", "y"]) {
    test(`cached integer loop preserves untouched ${String(y)} input when echoing ${echoVar}`, async context => {
      const source = `acc=0; for i in {1..5}; do acc=$((acc + y)); done; echo $${echoVar}`;
      const shell = new Shell({ fs: new MemoryFileSystem(), env: y === undefined ? {} : { y } }).use(standardCommands());
      context.after(() => shell.dispose());
      for (let run = 0; run < 4; run++) {
        const session = shell.createSession();
        assert.equal((await session.exec(source)).stdout, `${echoVar === "acc" ? "0" : y ?? ""}\n`);
        assert.equal((await session.exec('echo "${y-unset}"')).stdout, `${y ?? "unset"}\n`);
      }
    });
  }
}

test("cached integer loop honors IFS assigned by the body", async context => {
  const source = "acc=0; for i in {1..5}; do acc=$((acc + 11)); IFS=$((i)); done; echo $acc";
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { encoding: "utf8" });
  assert.equal(oracle.status, 0, oracle.stderr);
  for (let run = 0; run < 4; run++) assert.equal((await shell.exec(source)).stdout, oracle.stdout);
});

test("cached loop-variable IFS changes match ordinary execution", async context => {
  const source = "acc=0; for IFS in {1..5}; do acc=$((acc + 11)); done; echo $acc";
  const ordinary = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  ordinary.use(async (_context, next) => next());
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => ordinary.dispose());
  context.after(() => shell.dispose());
  const expected = await ordinary.exec(source);
  assert.equal(expected.stdout, " \n");
  for (let run = 0; run < 4; run++) assert.equal((await shell.exec(source)).stdout, expected.stdout);
});

test("cached integer overflow fallback preserves the finite parse allowance", async context => {
  const source = "a=0; for i in {1..5}; do y=$((y * 2)); done; echo $y";
  const warm = new Shell({ fs: new MemoryFileSystem(), env: { y: "1" } }).use(standardCommands());
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { y: "99999999" } }).use(standardCommands());
  context.after(() => warm.dispose());
  context.after(() => shell.dispose());
  for (let run = 0; run < 4; run++) await warm.exec(source);
  const result = await shell.exec(source, { limits: { maxParseUnits: 94 } });
  assert.equal(result.stdout, "3199999968\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});
