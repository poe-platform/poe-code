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
  ["--color=never alpha input", "alpha\nalpha beta\n"],
  ["--colour=auto alpha input", "alpha\nalpha beta\n"],
  ["--binary-files=text alpha input", "alpha\nalpha beta\n"],
  ["--binary alpha input", "alpha\nalpha beta\n"],
  ["--label=AUDIT alpha input", "alpha\nalpha beta\n"],
  ["--initial-tab -n alpha input", "2:\talpha\n4:\talpha beta\n"],
  ["-C0 --group-separator=AUDIT alpha input", "alpha\nalpha beta\n"],
  ["--color=always alpha input", "", 2],
  ["--binary-files=invalid alpha input", "", 2],
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

for (const command of ["grep", "egrep", "fgrep"]) {
  for (const options of ["-Lq", "-qL", "-L --quiet", "-L --silent", "-LqZ", "-Lcq"]) {
    for (const [content, exitCode] of [["y\n", 1], ["", 1], ["x\n", 0]] as const) {
      test(`${command} ${options} suppresses filenames for ${JSON.stringify(content)}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", Buffer.from(content));
        const shell = new Shell({ fs }).use(agentCommands());
        try {
          const result = await shell.exec(`${command} ${options} x input`);
          assert.equal(result.stdout, "");
          assert.equal(result.stderr, "");
          assert.equal(result.exitCode, exitCode);
        } finally { await shell.dispose(); }
      });
    }
  }
  test(`${command} -Lq searches later files without printing earlier filenames`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/nonmatching", Buffer.from("y\n"));
    await fs.writeFile("/matching", Buffer.from("x\n"));
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(`${command} -Lq x nonmatching matching`);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

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

test("grep prefixes and portable frontend controls match native grep over multibyte stdin", async () => {
  const input = Buffer.from("é\nalpha alpha\nother\nalpha\n");
  for (const args of [["-bn", "alpha"], ["-bno", "alpha"], ["-bC1", "alpha"], ["--color=never", "alpha"], ["--binary-files=text", "alpha"], ["-H", "--label=AUDIT", "alpha"]]) {
    const native = spawnSync("grep", args, { input, env: { ...process.env, LC_ALL: "C" } });
    assert.ifError(native.error);
    const actual = await run(grepCommands()[0]!, args, input);
    assert.equal(actual.code, native.status);
    assert.deepEqual(actual.stdout, native.stdout);
    assert.deepEqual(actual.stderr, native.stderr);
  }
});

test("grep frontend controls preserve CRLF bytes and label standard input", async () => {
  const definition = grepCommands()[0]!;
  const bytes = Buffer.from([120, 13, 10]);
  for (const flag of ["--binary", "--binary-files=text", "--color=never", "--colour=auto"]) {
    const result = await run(definition, [flag, "-FH", "--label=AUDIT", "x"], bytes);
    assert.equal(result.code, 0, result.stderr.toString());
    assert.deepEqual(result.stdout, Buffer.concat([Buffer.from("AUDIT:"), bytes]));
    assert.equal(result.stderr.length, 0);
  }
  const binary = Buffer.from([120, 0, 10]);
  const matching = await run(definition, ["--binary-files=text", "x"], binary);
  assert.equal(matching.code, 0, matching.stderr.toString());
  assert.deepEqual(matching.stdout, binary);
  assert.equal(matching.stderr.length, 0);
  const input = "x\nskip\nx\n";
  for (const [args, expected] of [
    [["-n", "--initial-tab", "x"], "1:\tx\n3:\tx\n"],
    [["-C0", "--group-separator=", "x"], "x\nx\n"],
    [["-C0", "--group-separator=AUDIT", "--no-group-separator", "x"], "x\nx\n"],
    [["--label=AUDIT", "x"], "x\nx\n"],
  ] as const) {
    const result = await run(definition, args, input);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), expected);
    assert.equal(result.stderr.length, 0);
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
