import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

test("stdbuf forwards pipeline input and runs unbuffered commands", async t => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("printf 'a\\n' | stdbuf -oL cat; echo \"rc=$?\"; stdbuf -o0 -e0 echo hi; echo \"rc=$?\"");
  assert.equal(result.stdout, "a\nrc=0\nhi\nrc=0\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("stdbuf preserves command arguments and child exit status", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  t.after(() => shell.dispose());
  const result = await shell.exec("stdbuf --output=L printf '%s\\n' 'a; echo injected' --help; stdbuf -o0 false");
  assert.equal(result.stdout, "a; echo injected\n--help\n");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 1);
  assert.equal((await shell.exec("stdbuf -o0 missing-command")).exitCode, 127);
  assert.equal((await shell.exec("myfn() { echo function; }; stdbuf -o0 myfn")).exitCode, 127);
});

test("configured stdbuf limits are applied by agentCommands", async t => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ stdbuf: { limits: { maxArgumentBytes: 6 } } }));
  t.after(() => shell.dispose());
  const result = await shell.exec("stdbuf -oL echo hi");
  assert.equal(result.exitCode, 125);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("argument byte limit exceeded"));
});

for (const [script, stdout] of [
  ["printf 'a\\n' | stdbuf -oL cat; echo \"rc=$?\"", "a\nrc=0\n"],
  ["stdbuf -o0 -e0 echo hi; echo \"rc=$?\"", "hi\nrc=0\n"],
] as const) {
  test(script, async t => {
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [script, stdout, exitCode] of [
  ["stdbuf --output=L --error 0 --input=4KiB printf '%s\\n' 'a b' '-oL'", "a b\n-oL\n", 0],
  ["stdbuf -o 1M -- false", "", 1],
  ["stdbuf -o0 missing-stdbuf-command", "", 127],
  ["stdbuf -iL echo hidden", "", 125],
  ["stdbuf -oBAD echo hidden", "", 125],
  ["stdbuf --output= echo hidden", "", 125],
  ["stdbuf -o", "", 125],
  ["stdbuf -o0", "", 125],
  ["stdbuf echo hidden", "", 125],
  ["stdbuf -x0 echo hidden", "", 125],
  ["stdbuf -o0 sh -c 'printf error >&2; exit 7'", "", 7],
] as const) {
  test(script, async t => {
    const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(script);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, exitCode, result.stderr);
    if (exitCode === 7) assert.equal(result.stderr, "error");
    if (exitCode === 125 || exitCode === 127) assert.notEqual(result.stderr, "");
  });
}
