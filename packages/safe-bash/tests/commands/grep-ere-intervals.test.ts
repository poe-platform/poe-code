import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";

test("grep -E accepts literal braces and omitted lower interval bounds in a script", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec(`printf '{"key": 1}\\n' | grep -E '{"key"'; echo $?; printf 'a{\\n' | grep -E 'a{'; echo $?; printf 'ab\\n' | grep -E 'a{,2}b'; echo $?`);
    assert.equal(result.stdout, '{"key": 1}\n0\na{\n0\nab\n0\n');
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const [pattern, input, output] of [
  ['{"key"', '{"key": 1}\nother\n', '{"key": 1}\n'],
  ["a{", "a{\na\n", "a{\n"],
  ["a{2", "a{2\naa\n", "a{2\n"],
  ["a{word}", "a{word}\na\n", "a{word}\n"],
  ["a{2,x}", "a{2,x}\naa\n", "a{2,x}\n"],
  ["^(a{,2})b$", "b\nab\naab\naaab\n", "b\nab\naab\n"],
  ["^a{,0}b$", "b\nab\n", "b\n"],
  ["^a{,}b$", "b\nab\naab\n", "b\nab\naab\n"],
  ["^a{2,3}b$", "ab\naab\naaab\naaaab\n", "aab\naaab\n"],
  ["a\\{,2\\}b", "a{,2}b\nab\n", "a{,2}b\n"],
] as const) test(`grep -E interval syntax: ${pattern}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`grep -E '${pattern}'`, { stdin: input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, output);
  } finally { await shell.dispose(); }
});

for (const pattern of ["a{}", "a{2,1}", "a{,1001}"]) test(`grep -E rejects invalid repetition bounds: ${pattern}`, async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`grep -E '${pattern}'`, { stdin: "a\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /invalid ERE repetition/u);
  } finally { await shell.dispose(); }
});
