import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { artifact } from './artifacts.mjs';
import { digest, sourceSnapshot } from '../jq-42-independent-review/common.mjs';

const before = sourceSnapshot();
assert.equal(before.structuredSha256, '30c573976d4dddb5e8e545f8e3914aeb166e0232f92ed0dfe20514205056db8f');
const executable = '/usr/bin/jq';
const sha256 = digest(readFileSync(executable));
assert.equal(sha256, '1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f');
const vectors = [];
function add(group, argv, input, files) {
  const inputHex = Buffer.from(input).toString('hex');
  vectors.push({ id: `${group}-${vectors.length}`, group, argv, inputHex, ...(files ? { files } : {}) });
}
const tokens = ['NaN','nan','NAN','Nan','nAn','+NaN','-NaN','+nan','-nan','NaN123','NaN(1)','nan(1)','Na','N','Infinity','infinity','INFINITY','Inf','inf','INF','InF','+Infinity','-Infinity','+Inf','-Inf','+infinity','-infinity','Infinite','infinite','Infinityx','Inf0','-','+','0','00','01','-01','+01','000.0100','1.','-1.','+1.','.1','-.1','+.1','.','1.e2','1.e+2','1.e-2','01e2','01.00e-2','1e','1e+','1e-','1e01','1E+02','1e9999','-1e9999','1e-9999','0x10','0XFF','0b10','1_0','1..0','1+2','--1','+-1','true','truefalse','tru','falsex','nullx','NULL'];
for (const token of tokens) {
  for (const input of [token, `${token}\n`, `[${token}]`, `{"x":${token}}`]) add('token', ['-c','.'], input);
  for (const filter of ['fromjson','tonumber']) add(filter, ['-c',filter], JSON.stringify(token));
  add('raw-fromjson', ['-Rc','fromjson'], `${token}\n`);
  add('source-number', ['-nc','--',token], '');
}
for (const token of ['NaN','Infinity','-Infinity','01','1.','true','1e','Na','1e9999']) {
  for (const suffix of [' 2','\t2','\r2','\n2','[]','{}','"s"',']','}',',2',':2',' NaN','\v2','\f2']) add('adjacent', ['-c','.'], token + suffix);
  add('recovery', ['-c','.[0]'], `${token}\n[9]\n`);
  add('fatal-after-output', ['-c','.'], `1\n${token}\n[}\n2\n`);
  add('quoted', ['-c','.'], JSON.stringify({ [token]: token, nested: [token, `escaped\\\"${token}`] }));
}
for (const input of ['\uFEFF0','\uFEFFNaN','\uFEFF[01,1.,NaN]',' \uFEFF0','0 \uFEFF1','\uFEFF\uFEFF0','[\uFEFF0]','"\uFEFFNaN"','\uFEFF','']) {
  add('bom', ['-c','.'], input);
  add('bom-fromjson', ['-c','fromjson'], JSON.stringify(input));
  add('bom-raw', ['-Rc','.'], input);
}
for (const bytes of [[239],[239,187],[239,0],[239,187,0],[255],[195],[195,40],[237,160,128],[240,159]]) {
  for (const prefix of ['', '{}\n','"é😀" ','{"é":','[']) add('bytes', ['-c','.'], Buffer.concat([Buffer.from(prefix),Buffer.from(bytes)]));
}
for (const input of ['[}','{]','[1}','{"a":]','{"a"}','{"a":}','[1,]','{"a":0,}','[1 2]','{"a" 1}','{1:2}','[,]',':',',','[','{','1e','truefalse','"bad\nstring"','"\\uD800"','"\\uDC00"']) {
  for (const prefix of ['', '\n\t', '"é😀"\n']) add('diagnostic', ['-c','.'], prefix + input);
  add('diagnostic-fromjson', ['-c','fromjson'], JSON.stringify(input));
}
for (const filter of ['[type,isnan,isinfinite,tostring,tojson]','[., .==., .<0, .>0, .==null, .+1, .-., .*0, ./2]','[., isnan, isinfinite]','[1/0,2]','1%0','0/0','join','join("-";":")','\njoin','\njoin("-";":")','split(.missing)','.["é😀"]','.[0]']) {
  for (const input of ['NaN','Infinity','-Infinity','1e9999','null','"s"','[]']) add('semantics', ['-c',filter], `${input}\n`);
}
for (const filter of ['nan','infinite','[nan,infinite,-infinite]|map([type,isnan,isinfinite,tostring,tojson])','[1e9999*0,1e9999-1e9999,1e9999/1e9999]|map([.,type,isnan,isinfinite])','1/0','1%0','0/0']) add('null-semantics',['-nc',filter],'');
const files = { 'first.json': Buffer.from('\uFEFF01\n').toString('hex'), 'second.json': Buffer.from('\uFEFFNaN\n').toString('hex'), 'filter.jq': Buffer.from('\njoin("-";":")\n').toString('hex') };
for (const [name, hex] of Object.entries(files)) artifact(`native-files/${name}`, Buffer.from(hex,'hex').toString(), true);
add('files', ['-c','.','first.json','second.json'], '', files);
add('file-filter', ['-c','-f','filter.jq'], '[]\n', files);
for (const vector of vectors) {
  const result = spawnSync(executable, vector.argv, { input: Buffer.from(vector.inputHex,'hex'), cwd: new URL('./native-files/',import.meta.url), shell: false, timeout: 2000, maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TERM: 'dumb' } });
  assert.ifError(result.error); assert.equal(result.signal,null);
  vector.expected = { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
}
const after = sourceSnapshot();
assert.equal(before.structuredSha256,after.structuredSha256);
artifact('native-frozen.json',{ recordedAt: new Date().toISOString(), before, after, profile: { executable,sha256,version: spawnSync(executable,['--version']).stdout.toString().trim(),build: spawnSync(executable,['--build-configuration']).stdout.toString().trim(), env: {LC_ALL:'C',LANG:'C',TZ:'UTC',TERM:'dumb'} }, primaryReferences: ['https://jqlang.org/manual/v1.7/','https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_parse.c','https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv.c'], vectors });
console.log(JSON.stringify({ vectors:vectors.length,source:before.structuredSha256 }));
