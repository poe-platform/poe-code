import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createHexdumpCommand } from "./index.js";

test("hexdump behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments(["-C"]);
 let output = "";
 const result = await createHexdumpCommand().execute({
  command: "hexdump", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("hello"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.includes("68 65 6c 6c 6f"), output);
});

for (const [format, input, expected] of [
 ['4/1 "%02x " "\\n"', 'abcdef', '61 62 63 64\n65 66      \n'],
 ['"%07.7_ax " 4/1 "%02x " "\\n" "%-7.7_Ax\\n"', 'abcd', '0000000 61 62 63 64\n0000004\n'],
 ['2/2 "%04x " "\\n"', 'abcd', '6261 6463\n'],
] as const) test(`custom format ${format}`, async () => {
 const values = createCommandArguments(['-e', format]);
 let output = '', errors = '';
 const result = await createHexdumpCommand().execute({
  command: 'hexdump', args: values.args, argumentValues: values, cwd: '/', env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(input),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, errors);
 assert.equal(output, expected);
});

for (const [label, args, input, expected] of [
 ['partial large blocks', ['-e', '32/1 "%02x " "\\n"'], Buffer.alloc(50, 65), '41 '.repeat(31) + '41\n' + '41 '.repeat(18) + ' '.repeat(41) + '\n'],
 ['zero byte count defaults', ['-e', '1/0 "%d\\n"'], Buffer.from('abcdef'), '1684234849\n26213\n'],
 ['unsigned conversions ignore sign flags', ['-e', '1/1 "%+x\\n"'], Buffer.from('ab'), '61\n62\n'],
 ['general floating conversions', ['-e', '1/4 "%g\\n"'], Buffer.from([0, 0, 128, 63, 0, 0, 0, 0]), '1\n0\n'],
 ['exponential floating conversions', ['-e', '1/4 "%e\\n"'], Buffer.from([0, 0, 128, 63]), '1.000000e+00\n'],
 ['final-only formats do not consume input', ['-e', '"%_Ax\\n"'], Buffer.from('abcdef'), ''],
 ['mixed format argument order', ['-e', '16/1 "%02x " "\\n"', '-C'], Buffer.from('abcdef'), '61 62 63 64 65 66' + ' '.repeat(30) + '\n00000000  61 62 63 64 65 66                                 |abcdef|\n00000006\n'],
 ['custom final address replaces default', ['-C', '-e', '"end:%_Ax\\n"'], Buffer.from('abc'), '00000000  61 62 63                                          |abc|\nend:3\n'],
 ['last final unit wins', ['-e', '1/1 "%x " "a%_Ax\\n" "b%_Ax\\n"'], Buffer.from('abc'), '61 62 63 b3\n'],
 ['zero integer precision suppresses zero', ['-e', '1/1 "%.0x"'], Buffer.from([0, 65]), '41'],
 ['octal precision supplies alternate prefix', ['-e', '1/1 "%#.4o"'], Buffer.from([1]), '0001'],
 ['octal zero retains alternate prefix', ['-e', '1/1 "%#.0o"'], Buffer.from([0]), '0'],
 ['decimal addresses accept sign flags', ['-e', '"%+_ad " 1/1 "%x\\n"'], Buffer.from([0]), '+0 0\n'],
 ['absent conversions ignore precision', ['-e', '2/1 "%.4x "'], Buffer.from([0]), '0000 '],
] as const) test(`custom format native parity: ${label}`, async () => {
 const values = createCommandArguments(['-v', ...args]);
 let output = '', errors = '';
 const result = await createHexdumpCommand().execute({
  command: 'hexdump', args: values.args, argumentValues: values, cwd: '/', env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(input),
  stdout: { async write(bytes) { output += Buffer.from(bytes).toString('latin1'); } },
  stderr: { async write(bytes) { errors += Buffer.from(bytes).toString('latin1'); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, errors);
 assert.equal(output, expected);
});

for (const [args, limits, diagnostic] of [
 [['-e', '1/3 "%x"'], {}, 'bad format'],
 [['-e', '"unterminated'], {}, 'bad format'],
 [['-e', '"%q"'], {}, 'bad format'],
 [['-e', '"%x"', '-C'], { maxFormats: 1 }, 'format count limit'],
 [['-e', '1000/1 "%x"'], { maxBufferedBytes: 500 }, 'format block limit'],
 [['-e', '"%100x"'], { maxOutputBytes: 10 }, 'output bytes limit'],
] as const) test(`custom formats reject malformed or over-budget input: ${args.join(' ')}`, async () => {
 const values = createCommandArguments(args);
 let errors = '';
 const result = await createHexdumpCommand({ limits }).execute({
  command: 'hexdump', args: values.args, argumentValues: values, cwd: '/', env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource('abcdef'),
  stdout: { async write() { assert.fail('invalid format must not produce output'); } },
  stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 1);
 assert.ok(errors.includes(diagnostic), errors);
});

for (const [format, number, expected] of [
 ['%.0f', 2.5, '2'], ['%.0f', 3.5, '4'],
 ['%g', 0.00001, '1e-05'], ['%g', 999999.9, '1e+06'],
 ['%#.0f', 1, '1.'], ['%#g', 1, '1.00000'],
 ['%+012.2f', 1.5, '+00000001.50'], ['%012.2f', -1.5, '-00000001.50'],
 ['%f', -0, '-0.000000'], ['%f', Infinity, 'inf'], ['%G', NaN, 'NAN'],
 ['%.110f', 0.5, '0.5' + '0'.repeat(109)],
 ['%.110e', 0.5, '5.' + '0'.repeat(110) + 'e-01'],
 ['%.110g', 0.5, '0.5'], ['%#.110g', 0.5, '0.5' + '0'.repeat(109)],
 ['%.0f', 1e21, '1000000000000000000000'],
] as const) test(`floating format ${format} with ${number}`, async () => {
 const input = new Uint8Array(8); new DataView(input.buffer).setFloat64(0, number, true);
 const values = createCommandArguments(['-e', `1/8 "${format}"`]);
 let output = '', errors = '';
 const result = await createHexdumpCommand().execute({
  command: 'hexdump', args: values.args, argumentValues: values, cwd: '/', env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(input),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, errors); assert.equal(output, expected);
});

test('custom output capacity includes already-retained input and earlier output', async () => {
 const { Budget, settings } = await import('./internal.js');
 const { formatCustom } = await import('./custom.js');
 const signal = new AbortController().signal;
 const budget = new Budget({
  command: 'hexdump', args: [], cwd: '/', env: {}, fs: createMemoryFileSystem(),
  stdin: toByteSource(''), stdout: { async write() {} }, stderr: { async write() {} }, signal,
 }, settings({ limits: { maxBufferedBytes: 1000 } }), signal, signal, { closed: false });
 budget.retain(900);
 await assert.rejects(formatCustom({ size: 0, units: [{ bytes: 0, repeat: 2, explicitRepeat: true, parts: ['1234567890'] }] }, new Uint8Array(), 0, 0, false, budget), /buffered bytes limit/);
 // Failed formatting releases its retained partial output.
 assert.doesNotThrow(() => budget.retain(100));
});

for (const format of ['1/8 "%.1000000000f"', '1/8 "%.1000000000d"', '1/8 "%1000000000g"']) test(`large formats respect explicit output limits before allocating: ${format}`, async () => {
 const values = createCommandArguments(['-e', format]);
 let errors = '';
 const result = await createHexdumpCommand({ limits: { maxOutputBytes: 20 } }).execute({
  command: 'hexdump', args: values.args, argumentValues: values, cwd: '/', env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(new Uint8Array(8)),
  stdout: { async write() { assert.fail('over-budget format must not write'); } },
  stderr: { async write(bytes) { errors += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 1); assert.ok(errors.includes('output bytes limit'), errors);
});
