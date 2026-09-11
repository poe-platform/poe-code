import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createBoundedRegexProvider } from "../../src/index.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";

const cases: readonly [string, string, string, number][] = [
  ["grep 'upload\\.wikimedia\\.org'", '<img src="https://upload.wikimedia.org/giraffe.jpg"> a+b\n', '<img src="https://upload.wikimedia.org/giraffe.jpg"> a+b\n', 0],
  ["grep -o 'https://upload\\.wikimedia\\.org/[^\" ]*'", '<img src="https://upload.wikimedia.org/giraffe.jpg"> a+b\n', "https://upload.wikimedia.org/giraffe.jpg\n", 0],
  ["grep '[+]'", "a+b\naab\n", "a+b\n", 0],
  ["grep 'a+b'", "a+b\naab\n", "a+b\n", 0],
  ["grep -o 'a+b'", "a+b aab a+b\n", "a+b\na+b\n", 0],
  ["grep -o '(a)'", "a (a)\n", "(a)\n", 0],
  ["grep -o 'a?b{2}|c'", "a?b{2}|c abbc\n", "a?b{2}|c\n", 0],
  ["grep -o '[+?(){}|]'", "+?(){}|a\n", "+\n?\n(\n)\n{\n}\n|\n", 0],
  ["grep -o 'a\\.b'", "axb a.b\n", "a.b\n", 0],
  ["grep -o 'a\\*b'", "aaab a*b\n", "a*b\n", 0],
  ["grep -o '\\^a\\$'", "a ^a$\n", "^a$\n", 0],
  ["grep -o '\\[a\\]'", "a [a]\n", "[a]\n", 0],
  ["grep -o 'a\\\\b'", "a\\b ab\n", "a\\b\n", 0],
  ["grep -ino 'a+b'", "é😀A+B\naab\na+b\n", "1:A+B\n3:a+b\n", 0],
  ["grep -io '[^+a-c]*'", "AbC+DEé😀\n", "DEé😀\n", 0],
  ["grep 'a+b'", "aaab\n", "", 1],
  ["grep -Eo 'a+b'", "aaab\n", "aaab\n", 0],
];

for (const [source, input, output, status] of cases) test(`bounded BRE literals: ${source}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(source, { stdin: input });
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(output));
  } finally { await shell.dispose(); }
});

for (const pattern of ["\\(a\\)", "a\\{2\\}", "a\\+", "a\\?", "a\\|b", "\\1", "\\w"]) {
  test(`bounded BRE retains unsupported ${pattern}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(`grep '${pattern}'`, { stdin: "aa\n" });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("unsupported"));
    } finally { await shell.dispose(); }
  });
}

test("bounded BRE literal operators retain match-count admission", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider({ maxMatchesPerLine: 1 }) }));
  try {
    const selected = await shell.exec("grep 'a+b'", { stdin: "a+b a+b\n" });
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(selected.stdout, "a+b a+b\n");
    const result = await shell.exec("grep -o 'a+b'", { stdin: "a+b a+b\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("limit"));
  } finally { await shell.dispose(); }
});

for (const reason of [false, Object.freeze({ abort: "BRE literal output" })]) test(`bounded BRE preserves ${typeof reason} cancellation`, async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  const controller = new AbortController();
  let writes = 0;
  const context: CommandContext = {
    command: "grep", args: ["-o", "a+b"], stdin: toByteSource("a+b a+b\n"), cwd: "/", env: {}, fs, signal: controller.signal,
    stdout: { async write(bytes) { if (bytes.length) { assert.deepEqual(bytes, new TextEncoder().encode("a+b")); writes++; controller.abort(reason); } } },
    stderr: { async write() { throw new Error("unexpected cancellation diagnostic"); } },
  };
  try {
    await shell.exec(":");
    await assert.rejects(Promise.resolve(shell.commands.get("grep")!.execute(context)), error => error === reason);
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});
