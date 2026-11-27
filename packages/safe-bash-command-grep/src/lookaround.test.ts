import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createGrepCommands } from "./index.js";

for (const [pattern, input, expected] of [
  ['(?<=id=")[^"]+', 'id="x1"\n', 'x1\n'],
  ['a(?=b)', 'ab\n', 'a\n'],
  ['a(?!b)', 'ab ac\n', 'a\n'],
  ['(?<!a)b', 'ab cb\n', 'b\n'],
  ['a(?=b(?=c))', 'abc\n', 'a\n'],
  ['(?<=a{2})b', 'aab\n', 'b\n'],
  ['(?<=^a)b', 'ab cab\n', 'b\n'],
  ['a(?=b$)', 'abc ab\n', 'a\n'],
  ['a(?!b)', 'ab\n', ''],
  ['(?<!a)b', 'ab\n', ''],
  ['(?<=a)b', 'b\n', ''],
  ['(?<!a)b', 'b\n', 'b\n'],
  ['(?=a)a', 'aa\n', 'a\na\n'],
] as const) {
  test(`grep -oP ${pattern} on ${JSON.stringify(input)}`, async () => {
    const values = createCommandArguments(['-oP', pattern]);
    let stdout = '', stderr = '';
    const result = await createGrepCommands()[0]!.execute({
      command: 'grep', args: values.args, argumentValues: values, cwd: '/work', env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(input),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.deepEqual({ ...result, stdout, stderr }, { exitCode: expected ? 0 : 1, stdout: expected, stderr: '' });
  });
}
