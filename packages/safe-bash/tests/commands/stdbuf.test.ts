import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

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
