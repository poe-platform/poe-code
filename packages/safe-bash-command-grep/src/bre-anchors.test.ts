import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createGrepCommands } from "./grep.js";

for (const [pattern, input, count] of [
  ['a$b', 'a$b\n', 1],
  ['a^b', 'a^b\n', 1],
  ['^*a', '*a\n', 1],
  ['\\(^*a$\\)\\|^b$', '*a\nb\nx*a\nxb\nbx\n', 2],
  ['a$$', 'a$\na\na$x\n', 1],
] as const) test(`grep -c ${pattern} treats BRE anchors by position`, async t => {
  const executor = new RegexExecutor(createBoundedRegexProvider());
  t.after(() => executor.dispose());
  const values = createCommandArguments(['-c', pattern]);
  let stdout = '', stderr = '';
  const result = await createGrepCommands(executor, { ergonomicRegex: true })[0]!.execute({
    command: 'grep', args: values.args, argumentValues: values, cwd: '/work', env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  assert.deepEqual({ ...result, stdout, stderr }, { exitCode: 0, stdout: `${count}\n`, stderr: '' });
});
