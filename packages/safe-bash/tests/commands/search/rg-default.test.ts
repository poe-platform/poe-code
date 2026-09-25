import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createBoundedRegexProvider } from "../../../src/commands/regex-execution/bounded-provider.js";
import { MemoryFileSystem, Shell, agentCommands } from "../../../src/index.js";

test("default agent rg searches ordinary patterns in virtual files", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("alpha\nbeta\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("rg alpha /input");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from("alpha\n"));
    assert.equal(result.stderr, "");
    assert.deepEqual(Buffer.from(await fs.readFile("/input")), Buffer.from("alpha\nbeta\n"));
  } finally { await shell.dispose(); }
});

test("rg help describes the default ASCII case and word profile", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("rg --help");
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("Case and word selection support ASCII patterns and subjects."));
  } finally { await shell.dispose(); }
});

for (const [command, input, output, code = 0] of [
  ["rg alpha -", "alpha\nbeta\n", "alpha\n"],
  ["rg 'a.ph[ab]+' -", "alpha\nalphaa\nbeta\n", "alpha\nalphaa\n"],
  ["rg -x '(alpha|beta)' -", "alpha\nbeta\nalphaa\n", "alpha\nbeta\n"],
  ["rg -n -v '^alpha$' -", "alpha\nbeta\n", "2:beta\n"],
  ["rg 'a{2,3}' -", "a\naa\naaaa\n", "aa\naaaa\n"],
  ["rg -o 'a|ab' -", "ab ab\n", "a\na\n"],
  ["rg -o 'ab|a' -", "ab ab\n", "ab\nab\n"],
  ["rg -o 'a+' -", "zaaa aa\n", "aaa\naa\n"],
  ["rg -o -e a -e ab -", "ab ab\n", "a\na\n"],
  ["rg -o -F -e a -e ab -", "ab ab\n", "a\na\n"],
  ["rg --count-matches 'a+' -", "aaa aa\n", "2\n"],
  ["rg --count-matches '' -", "é🦊\n", "7\n"],
  ["rg -o -b '.' -", "é🦊\n", "0:é\n2:🦊\n"],
  ["rg 'é🦊' -", "é🦊\ne\n", "é🦊\n"],
  ["rg -F 'a+b' -", "a+b\naaab\n", "a+b\n"],
  ["rg 'a\\+b' -", "a+b\naaab\n", "a+b\n"],
  ["rg --count-matches 'a*' -", "aaa aa\n", "2\n"],
  ["rg --count-matches '' -", "é🦊", "6\n"],
  ["rg -o '' -", "abc\n", "\n\n\n\n"],
  ["rg --null-data -o . -", "a\nb\u0000axb\u0000", "a\u0000b\u0000a\u0000x\u0000b\u0000"],
  ["rg --null-data -o 'a.b' -", "a\nb\u0000axb\u0000", "axb\u0000"],
  ["rg absent -", "alpha\nbeta\n", "", 1],
  ["rg --ignore-case -F alpha -", "Alpha beta\nalpha\nbeta\nalpha beta\n", "Alpha beta\nalpha\nalpha beta\n"],
  ["rg --smart-case -F alpha -", "Alpha\nalpha\n", "Alpha\nalpha\n"],
  ["rg --smart-case -F Alpha -", "Alpha\nalpha\n", "Alpha\n"],
  ["rg -i 'a[lL]pha' -", "ALPHA\nalpha\nbeta\n", "ALPHA\nalpha\n"],
  ["rg --word-regexp -F alpha -", "alpha\nalphabet\n_alpha\nalpha!\n", "alpha\nalpha!\n"],
  ["rg -w -o '(alpha|a)' -", "alpha alphabet a!\n", "alpha\na\n"],
  ["rg --replace=X -F alpha -", "Alpha beta\nalpha\nbeta\nalpha beta\n", "X\nX beta\n"],
  ["rg -r X -o alpha -", "alpha alpha\n", "X\nX\n"],
  ["rg --trim -F alpha -", "  alpha beta  \n\talpha\n", "alpha beta  \nalpha\n"],
  ["rg --max-filesize=1 -F alpha -", "alpha\n", "alpha\n"],
  ["rg --multiline -F alpha -", "alpha\nbeta\n", "alpha\n"],
  ["rg --threads=1 -F alpha -", "alpha\nbeta\n", "alpha\n"],
  ["rg -i -s alpha -", "Alpha\nalpha\n", "alpha\n"],
  ["rg -r '' alpha -", "alpha alpha\n", " \n"],
  ["rg -r X alpha -", "alpha alpha\n", "X X\n"],
] as const) {
  test(`default rg retains oracle bytes: ${command}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(command, { stdin: input });
      assert.equal(result.exitCode, code, result.stderr);
      assert.equal(result.stdout, output);
      assert.equal(result.stderr, "");
      if (process.env.SAFE_BASH_TEST_RG !== "1") return;
      const args = command.match(/'[^']*'|\S+/gu)!.slice(1).map(arg => arg.startsWith("'") ? arg.slice(1, -1) : arg);
      const native = spawnSync("rg", args, { input, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
      assert.ifError(native.error);
      assert.equal(result.exitCode, native.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), native.stdout);
      assert.deepEqual(Buffer.from(result.stderrBytes), native.stderr);
    } finally { await shell.dispose(); }
  });
}

for (const [flags, expected] of [
  ["--glob='*.txt'", "dir/a.txt:alpha\n"],
  ["--iglob='*.TXT'", "dir/a.txt:alpha\n"],
  ["--glob='*.{txt,skip}' --glob='!*.skip'", "dir/a.txt:alpha\n"],
  ["--glob='dir/**/a.?xt'", "dir/a.txt:alpha\n"],
  ["--glob='*.[t]xt'", "dir/a.txt:alpha\n"],
  ["--max-filesize=1", ""],
  ["--max-filesize=1K", "dir/a.txt:alpha\ndir/b.skip:alpha\n"],
  ["--maxdepth=1", "dir/a.txt:alpha\ndir/b.skip:alpha\n"],
  ["--ignore-file exclude", "dir/a.txt:alpha\n"],
  ["--ignore-file exclude --no-ignore-files", "dir/a.txt:alpha\ndir/b.skip:alpha\n"],
  ["--ignore-file exclude --no-ignore-files --ignore-files", "dir/a.txt:alpha\n"],
] as const) {
  test(`default rg filters virtual paths: ${flags}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work/dir/sub", { recursive: true });
    await fs.writeFile("/work/dir/a.txt", Buffer.from("alpha\n"));
    await fs.writeFile("/work/dir/b.skip", Buffer.from("alpha\n"));
    await fs.writeFile("/work/dir/sub/last", Buffer.from("beta\n"));
    await fs.writeFile("/work/exclude", Buffer.from("*.skip\n"));
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`rg ${flags} -F alpha dir`);
      assert.equal(result.exitCode, expected ? 0 : 1, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("default rg applies dot-ignore rules and explicit files bypass size filtering", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir");
  await fs.writeFile("/dir/keep", Buffer.from("alpha\n"));
  await fs.writeFile("/dir/drop", Buffer.from("alpha\n"));
  await fs.writeFile("/dir/.ignore", Buffer.from("drop\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("rg alpha /dir");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/dir/keep:alpha\n");
    assert.equal(result.stderr, "");
    const explicit = await shell.exec("rg --max-filesize=1 alpha /dir/drop");
    assert.equal(explicit.exitCode, 0, explicit.stderr);
    assert.equal(explicit.stdout, "alpha\n");
  } finally { await shell.dispose(); }
});

test("rg rejects unsupported profiles and malformed new options before input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    for (const command of ["rg --max-filesize=1T alpha -", "rg --threads=-1 alpha -", "rg -r '$1' alpha -"]) {
      let consumed = false;
      const stdin = (async function* () { consumed = true; yield Buffer.from("alpha\n"); })();
      const result = await shell.exec(command, { stdin });
      assert.equal(result.exitCode, 2, command);
      assert.equal(result.stdout, "");
      assert.equal(consumed, false);
    }
  } finally { await shell.dispose(); }
});

test("default rg validates unsupported and malformed regex before reading files", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    for (const pattern of ["[", "(?=a)", "(a)\\1"]) {
      const result = await shell.exec(`rg '${pattern}' /missing`);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /invalid ERE|unsupported/u);
      assert.doesNotMatch(result.stderr, /missing/u);
    }
  } finally { await shell.dispose(); }
});

test("default rg JSON reports regex matches with original UTF-8 byte offsets", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("rg --json 'a+' -", { stdin: "éaaa aa\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    const events = result.stdout.trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ["begin", "match", "end", "summary"]);
    assert.deepEqual(events[1].data.submatches, [
      { match: { text: "aaa" }, start: 2, end: 5 },
      { match: { text: "aa" }, start: 6, end: 8 },
    ]);
  } finally { await shell.dispose(); }
});

test("rg regex enumeration retains provider limits and recovers after an error", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
    regexExecutor: createBoundedRegexProvider({ maxMatchesPerLine: 1 }),
  }));
  try {
    const rejected = await shell.exec("rg -o 'a+' -", { stdin: "aaa aa\n" });
    assert.equal(rejected.exitCode, 2);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /matches per line limit/u);
    const result = await shell.exec("rg alpha -", { stdin: "alpha\nbeta\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "alpha\n");
  } finally { await shell.dispose(); }
});
