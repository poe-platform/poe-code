import assert from "node:assert/strict";
import { test } from "node:test";
import { getEventListeners } from "node:events";
import { Budget } from "./budget.js";
import { defaultLimits } from "./options.js";
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

test('budget borrows signals without retaining abort listeners', () => {
 const first = new AbortController(), second = new AbortController();
 const budget = new Budget(defaultLimits, first.signal);
 assert.equal(getEventListeners(first.signal, 'abort').length, 0);
 budget.signal = second.signal;
 first.abort();
 assert.equal(budget.aborted, false);
 second.abort('cancelled');
 assert.equal(budget.aborted, true);
 assert.throws(() => budget.check(), error => error === 'cancelled');
});

test('table aligns wide and combining characters by terminal columns', async () => {
 assert.equal((await run(['table'], 'a,b\n漢,x\né,z\n')).stdout, 'a   b\n--  -\n漢  x\né   z\n');
});

test('usage diagnostics do not need Node Buffer', async () => {
 const original = Object.getOwnPropertyDescriptor(globalThis, 'Buffer')!;
 Object.defineProperty(globalThis, 'Buffer', { value: undefined, configurable: true });
 try {
  const result = await run(['invalid']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /expected a CSV subcommand/);
 } finally { Object.defineProperty(globalThis, 'Buffer', original); }
});

test('arithmetic rejects invalid values and honors expression and output budgets', async () => {
 for (const expression of ['score / 0', 'missing + 1', 'score +', 'score ** 2', 'score,']) {
  assert.equal((await run(['select', '-e', expression])).exitCode, 1, expression);
 }
 assert.equal((await run(['select', '-e', 'score + 1'], undefined, { maxSelectorNodes: 1 })).exitCode, 1);
 assert.equal((await run(['select', '-e', 'score + 1'], undefined, { maxSelectorDepth: 1 })).exitCode, 1);
 assert.equal((await run(['table'], undefined, { maxOutputBytes: 10 })).exitCode, 1);
 assert.equal((await run(['table'], undefined, { maxRetainedBytes: 100 })).exitCode, 1);
 assert.equal((await run(['top', '-R', '-l', '1', 'score'])).stdout, 'name,score\nbob,2\n');
});

for (const [args, stdout] of [
 [['select', '-e', 'name, score * 2 as double_score'], 'name,double_score\nbob,4\nalice,20\ncarol,4\n'],
 [['map', 'score * (2 + 1)', 'triple'], 'name,score,triple\nbob,2,6\nalice,10,30\ncarol,2,6\n'],
 [['top', '-l', '2', 'score'], 'name,score\nalice,10\nbob,2\n'],
 [['table'], 'name   score\n-----  -----\nbob    2    \nalice  10   \ncarol  2    \n'],
] as [string[], string][]) test(`CSV feature ${args.join(' ')}`, async () => {
 assert.deepEqual(await run(args), { exitCode: 0, stdout, stderr: '' });
});

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

for (const [args, expected] of [
 [['dedup', '-s', 'score'], 'name,score\nbob,2\nalice,10\n'],
 [['enum'], 'index,name,score\n0,bob,2\n1,alice,10\n2,carol,2\n'],
 [['transpose'], 'name,bob,alice,carol\nscore,2,10,2\n'],
 [['agg', 'sum(score) as total, count() as n'], 'total,n\n14,3\n'],
 [['groupby', 'score', 'count() as n'], 'score,n\n2,2\n10,1\n'],
 [['cat', 'rows', '-', '/right.csv'], 'name,score\nbob,2\nalice,10\ncarol,2\nalice,Paris\nbob,Rome\nbob,Oslo\n'],
 [['to', 'json'], '[{"name":"bob","score":2},{"name":"alice","score":10},{"name":"carol","score":2}]\n'],
] as [string[], string][]) test(`extended xan ${args.join(' ')}`, async () => {
 assert.deepEqual(await run(args), { exitCode: 0, stdout: expected, stderr: '' });
});
test('from JSON converts objects into CSV columns', async () => {
 assert.deepEqual(await run(['from', '-f', 'json'], '[{"name":"bob","score":2}]'), { exitCode: 0, stdout: 'name,score\nbob,2\n', stderr: '' });
});
test('split writes CSV chunks through the virtual filesystem', async () => {
 const fs = createMemoryFileSystem();
 const values = createCommandArguments(['split', '-S', '2', '-O', '/chunks']);
 let errors = '';
 const result = await createXanCommand().execute({
  command: 'xan', args: values.args, argumentValues: values, cwd: '/', env: {}, fs,
  stdin: toByteSource('n\n1\n2\n3\n'), signal: new AbortController().signal,
  stdout: { async write() {} }, stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
 });
 assert.equal(result.exitCode, 0, errors);
 assert.equal(new TextDecoder().decode(await fs.readFile('/chunks/0.csv')), 'n\n1\n2\n');
 assert.equal(new TextDecoder().decode(await fs.readFile('/chunks/2.csv')), 'n\n3\n');
});

test('duplicate keys and replacements consume live memory rather than cumulative memory', async () => {
 for (const args of [['dedup'], ['dedup', '--keep-last'], ['groupby', '0', 'count()']]) {
  const result = await run(args, 'n\n' + 'a\n'.repeat(3000), { maxRetainedBytes: 32000 });
  assert.equal(result.exitCode, 0, `${args.join(' ')}: ${result.stderr}`);
 }
});


test('conversion accepts its output formats as destination paths', async () => {
 assert.equal((await run(['to', 'jsonl', '-o', '/output.jsonl'])).exitCode, 0);
});

test('sort rejects options belonging to other subcommands', async () => {
 for (const option of ['--pad', '--single-object', '--keep-duplicates']) assert.equal((await run(['sort', option])).exitCode, 1);
});


test('from applies record and field budgets to text and JSON input', async () => {
 for (const [format, input, limits] of [
  ['txt', 'a\nb\n', { maxRecords: 1 }],
  ['raw', 'abcd', { maxCellBytes: 3 }],
  ['json', '[{"a":"abcd"}]', { maxCellBytes: 3 }],
 ] as [string, string, Record<string, number>][]) assert.equal((await run(['from', '-f', format], input, limits)).exitCode, 1);
});

test('from charges only emitted CSV bytes to the output limit', async () => {
 assert.deepEqual(await run(['from', '-f', 'json'], '[{"a":1}]', { maxOutputBytes: 4 }), { exitCode: 0, stdout: 'a\n1\n', stderr: '' });
});

test('cat rows emits the first available header after an empty input', async () => {
 assert.deepEqual(await run(['cat', 'rows', '-', '/right.csv'], ''), { exitCode: 0, stdout: 'name,city\nalice,Paris\nbob,Rome\nbob,Oslo\n', stderr: '' });
});

test('groupby sums salary columns without requiring an alias', async () => {
 assert.deepEqual(await run(['groupby', 'dept', 'sum(salary)'],
  'dept,salary\nengineering,110\nsales,100\nengineering,120\n'), {
  exitCode: 0, stderr: '', stdout: 'dept,sum(salary)\nengineering,230\nsales,100\n'
 });
});

for (const options of [[], ['-s', 'name'], ['-n'], ['--help']]) {
 test(`view aliases table with ${options.join(' ')}`, async () => {
  const expected = await run(['table', ...options]);
  assert.equal(expected.exitCode, 0);
  assert.deepEqual(await run(['view', ...options]), expected);
 });
}
