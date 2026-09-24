import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/shell.js";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

const cases: readonly [string, unknown, { exitCode: number; stdout: string; stderr: string }][] = [
  ['[scan("[0-9]+")]', "a12b3", {"exitCode": 0, "stdout": "[\"12\",\"3\"]\n", "stderr": ""}],
  ['scan("[0-9]+")', "a12b3", {"exitCode": 0, "stdout": "\"12\"\n\"3\"\n", "stderr": ""}],
  ['[scan("([a-z]+)([0-9]+)")]', "a12bb3", {"exitCode": 0, "stdout": "[[\"a\",\"12\"],[\"bb\",\"3\"]]\n", "stderr": ""}],
  ['[scan("(a)?b")]', "bab", {"exitCode": 0, "stdout": "[[null],[\"a\"]]\n", "stderr": ""}],
  ['[scan("a|ab")]', "ab", {"exitCode": 0, "stdout": "[\"a\"]\n", "stderr": ""}],
  ['[scan("a+?")]', "aaa", {"exitCode": 0, "stdout": "[\"a\",\"a\",\"a\"]\n", "stderr": ""}],
  ['[scan("")]', "😀a", {"exitCode": 0, "stdout": "[\"\",\"\",\"\",\"\",\"\",\"\"]\n", "stderr": ""}],
  ['[scan(".")]', "😀\na", {"exitCode": 0, "stdout": "[\"😀\",\"a\"]\n", "stderr": ""}],
  ['[scan("z")]', "abc", {"exitCode": 0, "stdout": "[]\n", "stderr": ""}],
  ['[scan(("a", "b"))]', "aba", {"exitCode": 0, "stdout": "[\"a\",\"a\",\"b\"]\n", "stderr": ""}],
  ['scan("a")', 123, {"exitCode": 5, "stdout": "", "stderr": "jq: error (at <stdin>:1): number (123) cannot be matched, as it is not a string\n"}],
  ['scan(1)', "abc", {"exitCode": 5, "stdout": "", "stderr": "jq: error (at <stdin>:1): number (1) is not a string\n"}],
  ['scan("[")', "abc", {"exitCode": 5, "stdout": "", "stderr": "jq: error (at <stdin>:1): Regex failure: premature end of char-class\n"}],
];

for (const [filter, value, expected] of cases) test(`jq scan pinned native parity: ${filter} on ${JSON.stringify(value)}`, async () => {
  const stdin = `${JSON.stringify(value)}\n`;
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      expected);
  } finally { await shell.dispose(); }
});

test("jq scan accounts regex work against maxSteps", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands({ structured: { limits: { maxSteps: 1000 } } }));
  try {
    const result = await shell.exec(`jq -c '[scan("(a+)+$")]'`, { stdin: `${JSON.stringify("a".repeat(20) + "!")}\n` });
    assert.equal(result.exitCode, 5);
    assert.match(result.stderr, /maxSteps limit exceeded/u);
  } finally { await shell.dispose(); }
});
