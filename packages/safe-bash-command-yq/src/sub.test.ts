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
    stdin: toByteSource(new TextEncoder().encode(input)),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  return { exitCode: result.exitCode, stdout, stderr };
}

for (const [expression, input, stdout] of [
  ['.a |= sub("o", "0")', "a: hello world\n", "a: hell0 w0rld\n"],
  ['.a |= sub("o", "0")', "a: 'hello world' # keep\n", "a: 'hell0 w0rld' # keep\n"],
  ['sub("[0-9]+", "#")', "one12two34\n", "one#two#\n"],
  ['sub("missing", "x")', "hello\n", "hello\n"],
  ['sub("o", "")', "hello world\n", "hell wrld\n"],
  ['sub("(?i)hello", "hi")', "Hello HELLO\n", "hi hi\n"],
  ['sub("(a)(b)", "${2}${1}-$0-$$")', "ab\n", "ba-ab-$\n"],
  ['sub("(?P<word>[a-z]+)", "${word}!")', "hello world\n", "hello! world!\n"],
  ['sub("(a)?b", "$1-$9-$missing")', "b\n", "--\n"],
  ['sub("a", "$1x:${0}x:$:$$0")', "a\n", ":ax:$:$0\n"],
  ['sub("", "-")', "é😀\n", "-é-😀-\n"],
  ['sub("a*", "x")', "aab\n", "xbx\n"],
  ['sub("^|$", "-")', "hi\n", "-hi-\n"],
  ['sub(("o", "l"), "0")', "hello\n", "hell0\n"],
  ['sub("o", ("0", "!"))', "hello\n", "hell0\n"],
  ['sub(1, "b")', "a\n", "a\n"],
  ['sub("a", 1)', "a\n", "1\n"],
  ['sub(select(false), "b")', "a\n", "bab\n"],
  ['sub("a", select(false))', "a\n", "\n"],
] as const) test(`yq ${expression} on ${JSON.stringify(input)}`, async () => {
  assert.deepEqual(await run(expression, input), { exitCode: 0, stdout, stderr: "" });
});

for (const expression of ['sub()', 'sub("a",)', 'sub("[", "b")']) {
  test(`yq rejects invalid substitution ${expression}`, async () => {
    const result = await run(expression, "a\n");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Error: /u);
  });
}

test("yq sub rejects non-string input", async () => {
  assert.deepEqual(await run('sub("a", "b")', "42\n"), {
    exitCode: 1, stdout: "", stderr: "Error: cannot substitute with !!int, can only substitute strings. Hint: Most often you'll want to use '|=' over '=' for this operation\n",
  });
});

test("yq sub enforces scalar bytes and execution work", async () => {
  const expanded = await run('sub("a", "éé")', "aaaa\n", { maxScalarBytes: 8 });
  assert.equal(expanded.exitCode, 1);
  assert.match(expanded.stderr, /maxScalarBytes/u);
  const bounded = await run('sub("a", "b")', "a".repeat(1000), { maxSteps: 5000 });
  assert.equal(bounded.exitCode, 1);
  assert.match(bounded.stderr, /maxSteps/u);
});
