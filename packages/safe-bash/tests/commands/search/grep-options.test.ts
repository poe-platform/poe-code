import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { grepCommands } from "../../../src/commands/grep.js";
import { run } from "../grep-aliases/helpers.js";

const cases = [
  ["--byte-offset alpha input", "11:alpha\n22:alpha beta\n"],
  ["-l --null alpha input", "input\0"],
  ["-r --include='*.txt' alpha dir", "dir/a.txt:alpha\n"],
  ["-r --exclude='*.skip' alpha dir", "dir/a.txt:alpha\n"],
  ["-r --exclude-from=exclude alpha dir", "dir/a.txt:alpha\n"],
  ["--line-buffered alpha input", "alpha\nalpha beta\n"],
  ["-C0 --no-group-separator alpha input", "alpha\nalpha beta\n"],
  ["--no-ignore-case alpha input", "alpha\nalpha beta\n"],
  ["-bno alpha input", "2:11:alpha\n4:22:alpha\n"],
  ["-bC1 alpha unicode", "0-é\n3:alpha\n9-last\n"],
  ["-HZ alpha input", "input\0alpha\ninput\0alpha beta\n"],
  ["-r --exclude-dir=hidden alpha tree", "tree/a:alpha\n"],
  ["--directories=skip alpha dir", "", 1],
  ["--directories=recurse alpha dir", "dir/a.txt:alpha\ndir/b.skip:alpha\n"],
  ["--devices=skip alpha input", "alpha\nalpha beta\n"],
  ["-r alpha input", "alpha\nalpha beta\n"],
  ["-r --include='*.txt' --exclude='*' --include='a.*' alpha dir", "dir/a.txt:alpha\n"],
  ["-r alpha absent dir", "dir/a.txt:alpha\ndir/b.skip:alpha\n", 2],
  ["--directories=invalid alpha input", "", 2],
] as const;

for (const command of ["grep", "egrep", "fgrep"]) for (const [args, expected, code] of cases) {
  test(`${command} ${args}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/dir", { recursive: true });
    await fs.mkdir("/tree/hidden", { recursive: true });
    for (const [name, content] of Object.entries({ input: "Alpha beta\nalpha\nbeta\nalpha beta\n", "dir/a.txt": "alpha\n", "dir/b.skip": "alpha\n", exclude: "*.skip\n", unicode: "é\nalpha\nlast\n", "tree/a": "alpha\n", "tree/hidden/a": "alpha\n" })) {
      await fs.writeFile(`/${name}`, Buffer.from(content));
    }
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(`${command} ${args}`);
      assert.equal(result.exitCode, code ?? 0, result.stderr);
      assert.equal(result.stdout, expected);
      if (code === 2) assert.notEqual(result.stderr, "");
      else assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("grep byte prefixes match native grep over multibyte stdin", async () => {
  const input = Buffer.from("é\nalpha alpha\nother\nalpha\n");
  for (const args of [["-bn", "alpha"], ["-bno", "alpha"], ["-bC1", "alpha"]]) {
    const native = spawnSync("grep", args, { input, env: { ...process.env, LC_ALL: "C" } });
    assert.ifError(native.error);
    const actual = await run(grepCommands()[0]!, args, input);
    assert.equal(actual.code, native.status);
    assert.deepEqual(actual.stdout, native.stdout);
    assert.deepEqual(actual.stderr, native.stderr);
  }
});

test("grep recursion skips nested links with -r, follows with -R, and detects loops", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/tree");
  await fs.mkdir("/other");
  await fs.writeFile("/other/a", Buffer.from("alpha\n"));
  await fs.symlink("/other", "/tree/link");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    assert.equal((await shell.exec("grep -r alpha tree")).exitCode, 1);
    assert.equal((await shell.exec("grep -R alpha tree")).stdout, "tree/link/a:alpha\n");
    assert.equal((await shell.exec("grep -r alpha tree/link")).stdout, "tree/link/a:alpha\n");
    await fs.symlink("/tree", "/tree/loop");
    const result = await shell.exec("grep -R alpha tree");
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /recursive directory loop/u);
  } finally { await shell.dispose(); }
});
