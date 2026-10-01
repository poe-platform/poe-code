import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

for (const [name, source, env, expected] of [
  ["negative echo", "a=0; for i in {1..5}; do y=$((y - i)); done; echo $y", { y: "0" }, "-15\n"],
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
