import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureCase, directory, executable, invokeNative, sha256 } from './native.mjs';

const specs = [];
const add = (id, category, input, filter, flags = ['-c']) => specs.push({ id, category, inputHex: Buffer.from(input).toString('hex'), argv: [...flags, '--', filter] });
for (const token of ['0.00', '-0.00', '0e2', '0e-6', '0e-7', '0.0000000', '1.2300e3', '1.2300e-3', '1.2300e-7', '100e-2', '100e2', '0.000001', '0.0000001', '1e9999', '-1e9999', '1e-9999', '-1e-9999', '2.2250738585072012e-308', '4.9406564584124654e-324', '1.23456789012345665', '1.23456789012345675', '1.00000000000000011102230246251565404236316680908203125', '999999999999999995', '1000000000000000100']) {
  add(`decimal-${token}`, 'decimal-format', token, '[.,length,tojson,tonumber,([.]|join("|")),.+0]');
}
for (const token of ['1e15', '1e16', '1e17', '1e20', '1e21', '1e30', '1.23e17', '1.23e18', '1.2345678901234568e29', '1e-4', '1e-5', '1e-6', '1e-7', '-1e-7', '5e-324', '1.7976931348623157e308']) {
  add(`computed-${token}`, 'computed-format', token, '[.+0,length,-.,.*1]');
}
for (const [id, input] of [
  ['scale', '[1.0,1.00]'], ['zeros', '[-0.000,0e100]'], ['adjacent', '[9007199254740993,9007199254740992]'],
  ['negative', '[-9007199254740993,-9007199254740992]'], ['exponents', '[1e400,2e400]'],
  ['tiny', '[1e-400,2e-400]'], ['coefficient', '[100e-2,1.00]'],
  ['fraction', '[0.123456789012345678901,0.123456789012345678900]'],
]) add(`compare-${id}`, 'decimal-compare', input, '[.[0]==.[1],.[0]<.[1],.[0]>.[1],sort,unique,contains([.[1]])]');
add('compare-mixed-double', 'decimal-compare', '9007199254740993', '[.==(.+0),.>(.+0),[.,.+0]|unique]');
add('scalar-types', 'numeric-integration', '12.3400', '[type,numbers,scalars,(objects|type),(iterables|type),[.,"s",{},[],null,false]|sort]');
add('number-indices', 'numeric-integration', '[10,20,30]', '[.[1.0],.[-1],.[1:3],has(2.0),.[1]=12.3400]');
add('number-range', 'numeric-integration', 'null', '[range(0.0;3.0;1.0),limit(2.0;range(4))]');
add('number-repeat', 'numeric-integration', 'null', '["x"*2.0,3.0*"y",12.3400%2]');
add('preserve-through-copy', 'numeric-integration', '{"a":12.3400,"b":9007199254740993}', '[map_values(.),to_entries|from_entries,.a=0,.b|numbers]');
add('conversions-raw', 'numeric-integration', '12.3400\n9007199254740993\n42e+02\n', '[tonumber]|join("|")', ['-Rj']);
add('conversions-json', 'numeric-integration', '"[12.3400,9007199254740993,1e400]"', 'fromjson|tojson|fromjson|join("|")', ['-j']);
add('quant-generator-scalar', 'quantifier-generator', '7', '[any(.,false;.==7),all(.,8;.>0),any(empty;1/0),all(empty;1/0)]');
add('quant-generator-short', 'quantifier-generator', 'null', '[any((true,1/0);.),all((false,1/0);.)]');
add('quant-condition-short', 'quantifier-generator', '{"first":7,"later":0}', '[any(.[];true,1/0),all(.[];false,1/0)]');
add('quant-generator-caught', 'quantifier-generator', 'null', '[any((false,1/0);.)?,all((true,1/0);.)?]');
add('quant-empty-condition', 'quantifier-generator', 'null', '[any(range(5);empty),all(range(5);empty)]');
add('quant-insertion-order', 'quantifier-generator', '{"2":true,"1":false,"__proto__":null}', '[any(if . then true else 1/0 end),all(false)]');

const extra = process.argv[2]?.startsWith('--extra-') ?? false;
if (extra) {
  specs.length = 0;
  add('compare-mixed-double-grouped', 'decimal-compare', '9007199254740993', '[.==(.+0),.>(.+0),([.,.+0]|unique)]');
  add('scalar-types-grouped', 'numeric-integration', '12.3400', '[type,numbers,scalars,(objects|type),(iterables|type),([.,"s",{},[],null,false]|sort)]');
  add('preserve-through-copy-grouped', 'numeric-integration', '{"a":12.3400,"b":9007199254740993}', '[map_values(.),(to_entries|from_entries),(.a=0),(.b|numbers)]');
  add('arithmetic-overflow', 'numeric-integration', 'null', '[1e308*1e308,-1e308*1e308,1e400*0,1e400-1e400]');
  add('conversion-large-token', 'numeric-integration', 'null', '["1e9999"|tonumber,"[1e9999]"|fromjson]');
  add('range-literal-first', 'numeric-integration', 'null', '[range(0.00;2.00),range(1.2300;3.00)]');
}
const target = join(directory, extra ? 'phase2-extra-vectors.json' : 'phase2-vectors.json');
const mode = process.argv[2]?.replace('--extra-', '--');
assert.ok(['--freeze', '--verify', '--case'].includes(mode));
if (mode === '--case') {
  const fixture = specs.find(item => item.id === process.argv[3]);
  assert.ok(fixture);
  console.log(JSON.stringify(await captureCase(fixture), null, 2));
} else if (mode === '--verify') {
  const document = JSON.parse(await readFile(target, 'utf8'));
  assert.equal(sha256(await readFile(executable)), document.provenance.executableSha256);
  assert.deepEqual(await invokeNative(['--version']), document.provenance.version);
  assert.deepEqual(await invokeNative(['--build-configuration']), document.provenance.build);
  for (const fixture of document.cases) assert.deepEqual(await captureCase(fixture), fixture, fixture.id);
  console.log(`Verified ${document.cases.length} additive pre-fix native cases.`);
} else {
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  const productHashes = {};
  for (const name of ['input.ts', 'jq.ts', 'interpreter.ts', 'parser.ts', 'limits.ts', 'values.ts']) productHashes[name] = sha256(await readFile(new URL(`../../../../src/commands/structured/${name}`, import.meta.url)));
  const document = { provenance: { capturedAt: new Date().toISOString(), executable, executableSha256: sha256(await readFile(executable)), version: await invokeNative(['--version']), build: await invokeNative(['--build-configuration']), scriptSha256: sha256(await readFile(new URL(import.meta.url))), productHashes, note: 'Additive author investigation, native expectations captured before any phase-two product source changes. Same bounded literal-argv harness as phase one. Not independent final verification.' }, cases: [] };
  for (const fixture of specs) document.cases.push(await captureCase(fixture));
  const content = `${JSON.stringify(document, null, 2)}\n`;
  const applied = spawnSync('apply_patch', [`*** Begin Patch\n*** Add File: ${target}\n${content.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`], { shell: false, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
  assert.equal(applied.status, 0, applied.stderr);
  console.log(`${specs.length} additive native cases frozen: ${sha256(content)}`);
}
