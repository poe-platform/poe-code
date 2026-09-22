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

test("default rg validates unsupported and malformed regex before reading files", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  try {
    for (const pattern of ["[", "(?=a)", "(a)\\1", "a+?"]) {
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
