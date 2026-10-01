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

for (const [args, expected] of [
 [['head', '-l', '1'], 'name,score\nbob,2\n'],
 [['tail', '--limit', '1'], 'name,score\ncarol,2\n'],
 [['reverse'], 'name,score\ncarol,2\nalice,10\nbob,2\n'],
 [['sort', '-s', 'score', '-N'], 'name,score\nbob,2\ncarol,2\nalice,10\n'],
 [['sort', '-s', 'name', '-R'], 'name,score\ncarol,2\nbob,2\nalice,10\n'],
 [['search', '-s', 'name', 'ali'], 'name,score\nalice,10\n'],
 [['search', '-s', 'name', '-e', 'ali'], 'name,score\n'],
 [['filter', 'score > 2'], 'name,score\nalice,10\n'],
 [['rename', '-s', 'score', 'points'], 'name,points\nbob,2\nalice,10\ncarol,2\n'],
 [['drop', 'score'], 'name\nbob\nalice\ncarol\n'],
 [['freq', '-s', 'score'], 'field,value,count\nscore,2,2\nscore,10,1\n'],
 [['join', '--drop-key', 'none', 'name', '-', 'name', '/right.csv'], 'name,score,name,city\nbob,2,bob,Rome\nbob,2,bob,Oslo\nalice,10,alice,Paris\n'],
] as [string[], string][]) test(`core xan ${args.join(' ')}`, async () => {
 assert.deepEqual(await run(args), { exitCode: 0, stdout: expected, stderr: '' });
});

test('new commands enforce row alignment and retained memory limits', async () => {
 assert.equal((await run(['sort'], 'a,b\n1\n')).exitCode, 1);
 assert.equal((await run(['reverse'], undefined, { maxRetainedBytes: 100 })).exitCode, 1);
});

test('stats emits numeric aggregates and text statistics', async () => {
 const result = await run(['stats'], 'name,score\nbob,2\nalice,4\n');
 assert.deepEqual(result, { exitCode: 0, stderr: '', stdout:
 'field,count,count_empty,type,types,sum,mean,variance,stddev,min,max,lex_first,lex_last,min_length,max_length\n' +
 'name,2,0,string,string,0,,,,,,alice,bob,3,5\nscore,2,0,int,int,6,3,1,1,2,4,2,4,1,1\n' });
});

test('joins default to omitting duplicate keys and preserve unmatched rows', async () => {
 assert.equal((await run(['join', '--left', 'name', '-', '/right.csv'])).stdout,
 'name,score,city\nbob,2,Rome\nbob,2,Oslo\nalice,10,Paris\ncarol,2,\n');
 assert.equal((await run(['join', '--anti', 'name', '-', '/right.csv'])).stdout, 'name,score\ncarol,2\n');
});

test('numeric cells use decimal syntax rather than JavaScript radix prefixes', async () => {
 assert.equal((await run(['sort', '-N'], 'n\n0x10\n')).exitCode, 1);
 const stats = await run(['stats'], 'n\n0x10\n');
 assert.ok(stats.stdout.includes('n,1,0,string,string,0,'));
});
