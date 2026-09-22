import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { Shell, agentCommands, createMemoryFileSystem, createBoundedRegexProvider } from "../../src/index.js";

const cases: readonly [string, string, string, number][] = [
  ["grep -w alpha input", "alpha\n", "alpha\n", 0],
  ["grep --word-regexp alpha input", "alphabet\nxalpha\nalpha_\n_alpha\nalpha2\n2alpha\n(alpha)\nalpha alpha\n", "(alpha)\nalpha alpha\n", 0],
  ["grep -w alpha input", "alphabet\n", "", 1],
  ["grep -wnv alpha input", "alpha\nalphabet\n(alpha)\n", "2:alphabet\n", 0],
  ["grep -Fwo alpha input", "xalpha alpha_alpha alpha-alpha\n", "alpha\nalpha\n", 0],
  ["grep -Fwo aba input", "xababa aba\n", "aba\n", 0],
  ["grep -w @ input", "@\nx@y\n @ \n", "@\n @ \n", 0],
  ["grep -Ewo 'a|a-b' input", "a-bx a-b a\n", "a\na-b\na\n", 0],
  ["grep -Ewo 'a[-b]*' input", "a-bx\n", "a\n", 0],
  ["grep -Ewo '^alpha|beta$' input", "alphax beta\nalpha betax\n", "beta\nalpha\n", 0],
  ["grep -iwo alpha input", "ALPHA alphaX (AlPhA)\n", "ALPHA\nAlPhA\n", 0],
  ["grep -wo -e alpha -e beta input", "alphax beta alpha\n", "beta\nalpha\n", 0],
  ["grep -w '' input", "abc\n \n\na b\n", " \n\n", 0],
  ["grep -Fw '' input", "abc\n \n\na b\n", " \n\n", 0],
  ["grep -wx alpha input", "alpha\n alpha \n", "alpha\n", 0],
  ["grep -wx '' input", "\nabc\n", "\n", 0],
  ["grep -wz alpha input", "alpha\0alphax\0(alpha)\0", "alpha\0(alpha)\0", 0],
  ["LC_ALL=C grep -wo alpha input", "éalpha😀 alpha_\n", "alpha\n", 0],
  ["LC_ALL=C grep -Fwo -e '' -e a input", "aéa\n", "a\na\n", 0],
  ["LC_ALL=C grep -wo 'a*' input", "aéa\n", "a\na\n", 0],
  ["LC_ALL=C grep -w '' input", "aéa\n", "aéa\n", 0],
  ["LC_ALL=C grep -wo '' input", "aéa\n", "", 0],
  ["LC_ALL=C grep -Ewo '.{2}' input", "é\n", "é\n", 0],
];

for (const [source, input, output, status] of cases) test(`default grep whole-word matching: ${source} / ${JSON.stringify(input)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode(input));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, status, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, new TextEncoder().encode(output));
  } finally { await shell.dispose(); }
});

test("whole-word fixtures agree with the installed GNU grep in locale C", t => {
  const version = spawnSync("grep", ["--version"], { encoding: "utf8" });
  if (version.error || !version.stdout.includes("GNU grep")) { t.skip("GNU grep oracle unavailable"); return; }
  for (const [source, input, output, status] of cases) {
    const native = spawnSync("bash", ["-c", source.slice(0, -"input".length) + "-"], {
      input: new TextEncoder().encode(input), env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    });
    assert.ifError(native.error);
    assert.equal(native.status, status, source);
    assert.deepEqual(native.stderr, Buffer.alloc(0), source);
    assert.deepEqual(native.stdout, Buffer.from(output), source);
  }
  const byteMatches = spawnSync("grep", ["-wo", ".", "-"], {
    input: Buffer.from("é\n"), env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  });
  assert.ifError(byteMatches.error);
  assert.equal(byteMatches.status, 0);
  assert.deepEqual(byteMatches.stderr, Buffer.alloc(0));
  assert.deepEqual(byteMatches.stdout, Buffer.from([195, 10, 169, 10]));
});

test("whole-word C-locale regex output preserves individual UTF-8 bytes", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("LC_ALL=C grep -wo .", { stdin: "é\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(195, 10, 169, 10));
  } finally { await shell.dispose(); }
});

test("default grep whole-word matching preserves piped stdin", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("printf 'alpha alphabet (alpha)\\n' | grep -wo alpha");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "alpha\nalpha\n");
  } finally { await shell.dispose(); }
});

for (const flags of ["-wo", "-Fwo"]) test(`whole-word ${flags} retains match limits without partial output`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ regexExecutor: createBoundedRegexProvider({ maxMatchesPerLine: 1 }) }));
  try {
    const admitted = await shell.exec(`grep ${flags} a`, { stdin: "a\n" });
    assert.equal(admitted.exitCode, 0, admitted.stderr);
    assert.equal(admitted.stdout, "a\n");
    const limited = await shell.exec(`grep ${flags} a`, { stdin: "a a\n" });
    assert.equal(limited.exitCode, 2);
    assert.ok(limited.stderr.includes("matches per line limit exceeded"));
    assert.equal(limited.stdout, "");
  } finally { await shell.dispose(); }
});
