import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createYqCommand } from "./index.js";
import type { MikeLimits } from "./native-work.js";

async function run(expression: string, input: string, limits: Partial<MikeLimits> = {}) {
  let stdout = "", stderr = "";
  const result = await createYqCommand({ limits }).execute({
    command: "yq", ...createCommandArguments([expression]), cwd: "/work", env: {},
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}

for (const [expression, input, stdout] of [
  ['.a | trim', 'a: "  x  "\n', 'x\n'],
  ['.a | match("b.")', 'a: abc\n', 'string: bc\noffset: 1\nlength: 2\ncaptures: []\n'],
  ['.a | capture("(?P<x>a)(?P<y>b)")', 'a: abc\n', 'x: a\ny: b\n'],
] as const) test(`yq ${expression}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const [expression, input, stdout] of [
  ['.a |= trim', "a: '  x  ' # keep\n", "a: 'x' # keep\n"],
  ['trim', '"\\u0085\\u2003x\\u00a0"\n', 'x\n'],
  ['trim', '"\\ufeff x \\ufeff"\n', '\ufeff x \ufeff\n'],
  ['[match("missing")]', 'abc\n', '[]\n'],
  ['[capture("missing")]', 'abc\n', '[]\n'],
  ['capture("(?P<x>a)?(?P<y>b)")', 'b\n', 'x: null\ny: b\n'],
  ['capture("(?i)(?P<x>abc)")', 'ABC\n', 'x: ABC\n'],
  ['capture("(a)(b)")', 'ab\n', "\"\": a\n\"\": b\n"],
  ['match("(?P<x>😀)(a)?")', 'é😀\n', 'string: 😀\noffset: 2\nlength: 4\ncaptures:\n  - string: 😀\n    offset: 2\n    length: 4\n    name: x\n  - string: null\n    offset: -1\n    length: 0\n'],
  ['match("(a)(a)") | .captures[].offset', 'aaa\n', '0\n1\n'],
  ['[match("a", "g") | .offset]', 'éa😀a\n', '- 2\n- 7\n'],
  ['[match("a*", "g") | .offset]', 'aab\n', '- 0\n- 3\n'],
  ['[match("", "g") | .offset]', 'é😀\n', '- 0\n- 2\n- 6\n'],
  ['[capture("(?P<x>a)", "g")]', 'aba\n', '- x: a\n- x: a\n'],
  ['match(("a", "b")) | .string', 'abc\n', 'a\n'],
] as const) test(`yq string extraction ${expression} on ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const expression of ['trim', 'match("a")', 'capture("a")']) {
  test(`yq ${expression} rejects non-string input`, async () => {
    const result = await run(expression, '42\n');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /can only.*strings/u);
  });
}

for (const expression of ['match()', 'capture()', 'match("[")', 'capture("[")', 'match("a", "i")', 'capture("a", "z")']) {
  test(`yq rejects invalid extraction ${expression}`, async () => {
    const result = await run(expression, 'abc\n');
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^Error: /u);
  });
}

test('yq regex extraction enforces work and node budgets', async () => {
  const bounded = await run('match("a", "g")', 'a'.repeat(1000), { maxSteps: 5000 });
  assert.equal(bounded.exitCode, 1);
  assert.match(bounded.stderr, /maxSteps/u);
  const nodes = await run('match("a", "g")', 'a'.repeat(100), { maxNodes: 30 });
  assert.equal(nodes.exitCode, 1);
  assert.match(nodes.stderr, /maxNodes/u);
});
