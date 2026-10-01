import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createXanCommand } from "./index.js";

test("xan help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createXanCommand().execute({
  command: "xan", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

async function run(args: string[], input = 'name,score\nbob,2\nalice,10\ncarol,2\n', limits = {}) {
 const values = createCommandArguments(args);
 let stdout = '', stderr = '';
 const fs = createMemoryFileSystem();
 await fs.writeFile('/right.csv', new TextEncoder().encode('name,city\nalice,Paris\nbob,Rome\nbob,Oslo\n'));
 const result = await createXanCommand({ limits }).execute({
  command: 'xan', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
  stdin: toByteSource(input), signal: new AbortController().signal,
  stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
 });
 return { ...result, stdout, stderr };
}

test('slice last works with default unbounded limits and checks explicit bounds', async () => {
 assert.deepEqual(await run(['slice', '-L', '1']), { exitCode: 0, stdout: 'name,score\ncarol,2\n', stderr: '' });
 assert.equal((await run(['slice', '-L', '0'])).stdout, 'name,score\n');
 assert.equal((await run(['slice', '-L', '4'])).stdout, 'name,score\nbob,2\nalice,10\ncarol,2\n');
 assert.equal((await run(['slice', '-L', '2'], undefined, { maxLastRows: 1 })).exitCode, 1);
 assert.equal((await run(['slice', '-L', '18446744073709551615'])).exitCode, 1);
});
