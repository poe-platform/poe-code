import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, createBoundedRegexProvider } from "../../src/index.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";

const cases: readonly [string, string, string, number][] = [
  ["grep -i giraffe", "<img src=\"https://upload.wikimedia.org/Giraffe.jpg\"> a+b\n", "<img src=\"https://upload.wikimedia.org/Giraffe.jpg\"> a+b\n", 0],
  ["grep -Eoi 'https://upload\\.wikimedia\\.org/[^\" ]*'", '<img src="HTTPS://Upload.Wikimedia.Org/Giraffe.JPG"> a+b\n', "HTTPS://Upload.Wikimedia.Org/Giraffe.JPG\n", 0],
  ["grep -in giraffe", "other\nGiRaFfE é😀\nunrelated\nGIRAFFE\n", "2:GiRaFfE é😀\n4:GIRAFFE\n", 0],
  ["grep -i giraffe", "giraffé\n", "", 1],
  ["grep -Fi 'a+b'", "A+B\naab\n", "A+B\n", 0],
  ["grep -Fio 'a+b'", "éA+b😀a+B\n", "A+b\na+B\n", 0],
  ["grep -Eio '[a-c]+'", "AbCDEabc\n", "AbC\nabc\n", 0],
  ["grep -Eio '[^a-c]+'", "AbCDEé😀abc\n", "DEé😀\n", 0],
  ["grep -Eio '[[:upper:]]+'", "Abzé\n", "Abz\n", 0],
  ["grep -Eio '[[:lower:]]+'", "AbZé\n", "AbZ\n", 0],
  ["grep -Eio '[^[:lower:]]+'", "AbZé😀\n", "é😀\n", 0],
  ["LC_ALL=C grep -Eio '^a.$'", "A😀\naé\n", "A😀\naé\n", 0],
  ["grep -Fio 'éA'", "Éa éa éA\n", "éa\néA\n", 0],
  ["grep -Fio k", "KKk\n", "K\nk\n", 0],
  ["grep -io -e a -e ab", "ABa\n", "AB\na\n", 0],
  ["grep -Eio 'a*'", "bAA\n", "AA\n", 0],
  ["grep -Fixo a", "A\naa\n", "A\n", 0],
  ["grep -i a", "aA\n", "aA\n", 0],
  ["grep a", "A\n", "", 1],
];
for (const [source, input, output, status] of cases) test(`bounded grep ASCII folding: ${source}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(source, { stdin: input });
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(output));
  } finally { await shell.dispose(); }
});

for (const source of ["grep -iw a", "rg -Fi a", "grep -i é"]) test(`ASCII folding does not widen ${source}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(source, { stdin: "é A\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("unsupported"));
  } finally { await shell.dispose(); }
});

for (const flags of ["-i", "-Fi", "-Eio"]) test(`ASCII folding ${flags} retains request match limits`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider({ maxMatchesPerLine: 1 }) }));
  try {
    const selected = await shell.exec(`grep ${flags} a`, { stdin: "A\n" });
    assert.equal(selected.exitCode, 0, selected.stderr);
    assert.equal(selected.stdout, "A\n");
    const result = await shell.exec(`grep ${flags} a`, { stdin: "aA\n" });
    assert.equal(result.exitCode, flags === "-Eio" ? 2 : 0, result.stderr);
    assert.equal(result.stdout, flags === "-Eio" ? "" : "aA\n");
  } finally { await shell.dispose(); }
});

for (const reason of [false, Object.freeze({ abort: "folded output" })]) test(`ASCII folding preserves ${typeof reason} cancellation`, async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  const controller = new AbortController();
  let writes = 0;
  const context: CommandContext = {
    command: "grep", args: ["-Fio", "a"], stdin: toByteSource("Aa\n"), cwd: "/", env: {}, fs, signal: controller.signal,
    stdout: { async write(bytes) { if (bytes.length) { assert.deepEqual(bytes, Uint8Array.of(65)); writes++; controller.abort(reason); } } },
    stderr: { async write() { throw new Error("unexpected cancellation diagnostic"); } },
  };
  try {
    await shell.exec(":");
    await assert.rejects(Promise.resolve(shell.commands.get("grep")!.execute(context)), error => error === reason);
    assert.equal(writes, 1);
  } finally { await shell.dispose(); }
});

test("ASCII folding preserves the shell output byte bound", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  let bytes = 0;
  try {
    await assert.rejects(shell.exec("grep -Fio a", {
      stdin: "Aa\n", limits: { maxOutputBytes: 2 }, stdout: { async write(chunk) { bytes += chunk.length; } },
    }), { limit: "maxOutputBytes" });
    assert.ok(bytes <= 2);
  } finally { await shell.dispose(); }
});
