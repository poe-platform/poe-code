import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createBoundedRegexProvider } from "../../src/index.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";

const html = '<div class="section-title">⚽ Alternate Plan: Football Fans</div>\n';

for (const source of [
  "grep -n 'section-title' /day5.html",
  "LC_ALL=C grep -n 'Alternate Plan' /day5.html",
]) test(`ordinary UTF-8 grep: ${source}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/day5.html", Buffer.from(html));
  const shell = new Shell({ fs }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from("1:" + html)));
  } finally { await shell.dispose(); }
});

for (const [source, input, output, status] of [
  ["grep -n target", "café 🦒 unrelated\n⚽ target café\nmañana target 😀\n", "2:⚽ target café\n3:mañana target 😀\n", 0],
  ["grep -n target", "café 🦒 unrelated\n", "", 1],
  ["grep -En 'target[0-9]+'", "café target12 😀\n⚽ targetx\n", "1:café target12 😀\n", 0],
  ["grep -no target", "é⚽target😀target\n", "1:target\n1:target\n", 0],
  ["LC_ALL=C grep -Eno 'ab+'", "é⚽abbb😀ab\n", "1:abbb\n1:ab\n", 0],
  ["grep -Eo '.'", "é😀a\n", "é\n😀\na\n", 0],
  ["LC_ALL=C grep -Eo '.'", "é😀a\n", "é\n😀\na\n", 0],
  ["grep -Eo '[^a]'", "é😀a\n", "é\n😀\n", 0],
  ["grep -Eo '[[:alpha:]]+'", "é😀az\n", "az\n", 0],
  ["grep -Eo '^..$'", "é😀\nabc\n", "é😀\n", 0],
  ["grep -Eo '.'", "e\u0301\n", "e\n\u0301\n", 0],
] as const) test(`ordinary UTF-8 grep exact bytes: ${source} / ${status}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  try {
    const result = await shell.exec(source, { stdin: Buffer.from(input) });
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from(output)));
  } finally { await shell.dispose(); }
});

for (const bytes of [Uint8Array.of(255, 97, 10), Uint8Array.of(0, 97, 10)]) {
  test(`ordinary UTF-8 grep refuses invalid subject ${bytes[0]}`, async () => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
    try {
      const result = await shell.exec("grep -ao a", { stdin: bytes });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes("unsupported"));
    } finally { await shell.dispose(); }
  });
}

test("ordinary UTF-8 grep keeps non-ASCII regex patterns unsupported", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  try {
    const result = await shell.exec("grep é", { stdin: "é\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("unsupported"));
  } finally { await shell.dispose(); }
});

for (const [options, input] of [
  [{ maxInputBytes: 3 }, "😀\n"],
  [{ maxMatchesPerLine: 1 }, "é😀\n"],
  [{ maxTotalMatches: 1 }, "é\n😀\n"],
  [{ maxResultBytes: 16 }, "é😀\n"],
] as const) test(`ordinary UTF-8 grep retains ${Object.keys(options)[0]}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider(options) }));
  try {
    const admitted = await shell.exec("grep -Eo .", { stdin: "é\n" });
    assert.equal(admitted.exitCode, 0, admitted.stderr);
    assert.equal(admitted.stdout, "é\n");
    const result = await shell.exec("grep -Eo .", { stdin: input });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("limit"));
  } finally { await shell.dispose(); }
});

for (const reason of [false, Object.freeze({ cancelled: "UTF-8 output" })]) test(`ordinary UTF-8 grep preserves ${typeof reason} cancellation`, async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  const controller = new AbortController();
  let writes = 0;
  const context: CommandContext = {
    command: "grep", args: ["-Eo", "."], stdin: toByteSource("é😀\n"), cwd: "/", env: {}, fs, signal: controller.signal,
    stdout: { async write(bytes) {
      if (!bytes.length) return;
      assert.deepEqual(bytes, new Uint8Array(Buffer.from("é")));
      writes++;
      controller.abort(reason);
    } },
    stderr: { async write() { throw new Error("cancelled invocation emitted a diagnostic"); } },
  };
  try {
    await shell.exec(":");
    await assert.rejects(Promise.resolve(shell.commands.get("grep")!.execute(context)), error => error === reason);
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

test("ordinary UTF-8 grep awaits extracted byte output", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { started = resolve; });
  const chunks: Uint8Array[] = [];
  let writes = 0, settled = false;
  const pending = shell.exec("grep -Eo .", { stdin: "é😀\n", stdout: {
    async write(bytes) {
      if (!bytes.length) return;
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
    assert.deepEqual(Buffer.concat(chunks), Buffer.from("é\n😀\n"));
  } finally { release(); await pending; await shell.dispose(); }
});

test("ordinary UTF-8 grep output limits count original bytes", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
  let written = 0;
  try {
    await assert.rejects(shell.exec("grep -Eo .", {
      stdin: "é😀\n", limits: { maxOutputBytes: 3 },
      stdout: { async write(bytes) { written += bytes.length; } },
    }), { limit: "maxOutputBytes" });
    assert.ok(written <= 3);
  } finally { await shell.dispose(); }
});
