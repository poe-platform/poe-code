import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createBoundedRegexProvider, portableSearchCommands } from "../../src/index.js";
import type { BoundedRegexProviderOptions } from "../../src/commands/regex-execution/bounded-provider.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";

const cases: readonly [string, string[], string, string, number][] = [
  ["BRE literal", ["-o", "giraffe"], "giraffe giraffe\n", "giraffe\ngiraffe\n", 0],
  ["fixed metacharacters", ["-Fo", "a+b"], "a+ba+b\n", "a+b\na+b\n", 0],
  ["ERE URL", ["-Eo", 'https://upload\\.wikimedia\\.org/[^" ]*'], '<img src="https://upload.wikimedia.org/giraffe.jpg">\n', "https://upload.wikimedia.org/giraffe.jpg\n", 0],
  ["longest alternative", ["-Eo", "a|aa"], "aaa\n", "aa\na\n", 0],
  ["multiple patterns", ["-o", "-e", "a", "-e", "ab"], "ab a\n", "ab\na\n", 0],
  ["overlapping alternatives use the global cursor", ["-Eo", "-e", "ab", "-e", "b..b"], "abxxbxxb\n", "ab\nbxxb\n", 0],
  ["fixed UTF-8 bytes", ["-Fo", "é"], "aéé\n", "é\né\n", 0],
  ["no match", ["-o", "absent"], "other\n", "", 1],
  ["empty only", ["-Fo", ""], "abc\n", "", 0],
  ["anchor only", ["-Eo", "^"], "abc\n", "", 0],
  ["empty then nonempty", ["-Eo", "a*"], "baac\n", "aa\n", 0],
  ["line and file prefixes", ["-nHo", "a"], "ba a\nb\n", "(standard input):1:a\n(standard input):1:a\n", 0],
  ["count selected lines", ["-co", "a"], "aaa\na\nb\n", "2\n", 0],
  ["quiet", ["-qo", "a"], "aaa\n", "", 0],
  ["invert", ["-vo", "a"], "b\n", "", 0],
  ["max selected lines", ["-m", "1", "-o", "a"], "aa\naa\n", "a\na\n", 0],
  ["NUL records", ["-zFo", "a"], "a\0aa\0", "a\0a\0a\0", 0],
];

function command(args: readonly string[]): string {
  return "grep " + args.map(argument => "'" + argument.replaceAll("'", "'\\''") + "'").join(" ");
}

for (const [name, args, input, output, status] of cases) test(`bounded grep -o: ${name}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  try {
    const result = await shell.exec(command(args), { stdin: Buffer.from(input) });
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from(output)));
  } finally { await shell.dispose(); }
});

for (const [flags, expected, status, input] of [
  ["-co", "1\n", 0, "aaa\n"], ["-qo", "", 0, "aaa\n"], ["-lo", "(standard input)\n", 0, "aaa\n"],
  ["-Lo", "", 1, "aaa\n"], ["-vo", "", 0, "aaa\nb\n"],
] as const) {
  test(`bounded grep ${flags} only needs selection, not extraction ranges`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(portableSearchCommands({ provider: createBoundedRegexProvider({ maxMatchesPerLine: 1 }) }));
    try {
      const result = await shell.exec(`grep ${flags} a`, { stdin: input });
      assert.equal(result.exitCode, status, result.stderr);
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

test("bounded grep -o uses VFS filenames and byte-preserving fixed extraction", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/one", Buffer.from("éaa\n"));
  await fs.writeFile("/two", Buffer.from("a\n"));
  const shell = new Shell({ fs }).use(portableSearchCommands({ provider: createBoundedRegexProvider() }));
  try {
    const result = await shell.exec("grep -nFo a /one /two");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "/one:1:a\n/one:1:a\n/two:1:a\n");
  } finally { await shell.dispose(); }
});

test("bounded grep -o awaits each sink write before emitting another match", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(portableSearchCommands({ provider: createBoundedRegexProvider() }));
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { started = resolve; });
  const chunks: Uint8Array[] = [];
  let writes = 0, settled = false;
  const pending = shell.exec("grep -Fo a", { stdin: "aa\n", stdout: {
    async write(bytes) {
      if (bytes.length === 0) return;
      chunks.push(new Uint8Array(bytes));
      if (++writes === 1) { started(); await blocked; }
    },
  } }).then(result => { settled = true; return result; });
  try {
    await Promise.race([first, pending.then(() => { throw new Error("extraction produced no output"); })]);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(writes, 1);
    assert.equal(settled, false);
    release();
    assert.equal((await pending).exitCode, 0);
    assert.equal(Buffer.concat(chunks).toString(), "a\na\n");
  } finally { release(); await pending; await shell.dispose(); }
});

for (const reason of [false, Object.freeze({ cancelled: "match output" })]) test(`bounded grep -o preserves ${typeof reason} cancellation during output`, async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(portableSearchCommands({ provider: createBoundedRegexProvider() }));
  const controller = new AbortController();
  let writes = 0;
  const context: CommandContext = {
    command: "grep", args: ["-Fo", "a"], stdin: toByteSource("aaa\n"), cwd: "/", env: {}, fs, signal: controller.signal,
    stdout: { async write(bytes) { if (bytes.length) { writes++; controller.abort(reason); } } },
    stderr: { async write() { throw new Error("cancelled invocation emitted a diagnostic"); } },
  };
  try {
    await shell.exec(":");
    await assert.rejects(Promise.resolve(shell.commands.get("grep")!.execute(context)), error => error === reason);
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

test("bounded grep -o respects the caller's output byte limit", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(portableSearchCommands({ provider: createBoundedRegexProvider() }));
  let bytes = 0;
  try {
    await assert.rejects(shell.exec("grep -Fo a", {
      stdin: "aa\n", limits: { maxOutputBytes: 3 }, stdout: { async write(chunk) { bytes += chunk.length; } },
    }), { limit: "maxOutputBytes" });
    assert.ok(bytes <= 3);
  } finally { await shell.dispose(); }
});

test("bounded grep -o retains the explicit invalid UTF-8 subject refusal", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(portableSearchCommands({ provider: createBoundedRegexProvider() }));
  try {
    const result = await shell.exec("grep -Fo a", { stdin: Uint8Array.of(255, 97, 10) });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /valid non-NUL UTF-8/);
  } finally { await shell.dispose(); }
});

for (const [options, input, diagnostic] of [
  [{ maxMatchesPerLine: 2 }, "aaa\n", "match"],
  [{ maxTotalMatches: 2 }, "aa\na\n", "match"],
  [{ maxInputBytes: 2 }, "aaa\n", "input"],
  [{ maxResultBytes: 16 }, "aa\n", "result"],
] as const) test(`bounded grep -o refuses ${Object.keys(options)[0]} before emitting a partial reply`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(portableSearchCommands({ provider: createBoundedRegexProvider(options as BoundedRegexProviderOptions) }));
  try {
    const admitted = await shell.exec("grep -Fo a", { stdin: "a\n" });
    assert.equal(admitted.exitCode, 0, admitted.stderr);
    assert.equal(admitted.stdout, "a\n");
    const result = await shell.exec("grep -Fo a", { stdin: input });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, new RegExp(diagnostic));
    assert.equal(result.stdout, "");
  } finally { await shell.dispose(); }
});
