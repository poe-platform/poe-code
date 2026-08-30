import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';

const owned = 'tests/compatibility/bash-arithmetic-parameters-independent-20260829';
const packet = 'tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const findings = [];
const admitted = [];
let readBytes = 0;
function read(filename, pin) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.size > 4 * 1024 * 1024) throw Error('ADMISSION ' + filename);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!count) throw Error('SHORT ' + filename);
      offset += count;
    }
    const after = fs.fstatSync(descriptor);
    if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs || fs.readSync(descriptor, Buffer.alloc(1), 0, 1, bytes.length)) throw Error('CHANGED ' + filename);
    readBytes += bytes.length;
    if (readBytes > 96 * 1024 * 1024) throw Error('READ_CEILING');
    const row = { path: filename, bytes: bytes.length, sha256: hash(bytes) };
    admitted.push(row);
    if (pin && (row.bytes !== pin.bytes || row.sha256 !== pin.sha256)) throw Error('PIN ' + filename);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
const seal = JSON.parse(read(packet + '/future/SEAL.json', { bytes: 196558, sha256: 'ba016c4ff6bfa1add722d65c59a0d4f740e43ca652c56bfc12610472bb633d91' }));
for (const [name, pin] of Object.entries(seal.files)) read(packet + '/future/' + name, pin);
for (const [name, pin] of Object.entries(seal.helperPins)) read(path.join(seal.helperRoot, name), pin);
const binding = JSON.parse(read(seal.sourceBinding.path, seal.sourceBinding));
const buildSeal = JSON.parse(read(packet + '/BUILD-SEAL.json', { bytes: 85429, sha256: '30100c3b0694685825207cb6d9beb2802ba7eee450a45f0a9d63ea711c107470' }));
const archive = read(seal.archive.path, seal.archive);
const encoded = read(packet + '/evidence/package.tgz.base64').toString().trim();
if (archive.toString('base64') !== encoded) throw Error('BASE64_PRESERVATION');
for (const pin of seal.shipping) read(path.join(seal.sourceApp, pin.path), pin);
const runtime = read(owned + '/pinned-runtime.txt').toString();
const helper = read(owned + '/pinned-arithmetic-parameters.txt').toString();
const sourceRuntime = binding.find(row => row.path === 'src/shell/runtime.ts');
const sourceHelper = binding.find(row => row.path === 'src/shell/arithmetic-parameters.ts');
if (hash(Buffer.from(runtime)) !== sourceRuntime.sha256 || hash(Buffer.from(helper)) !== sourceHelper.sha256) throw Error('PINNED_SOURCE_BINDING');
const diff = read(owned + '/source.diff').toString();
let reversed = runtime;
for (const hunk of diff.split(/^@@.*@@.*\n/m).slice(1)) {
  const records = hunk.split('\n').filter(line => /^[ +\-]/.test(line));
  const before = records.filter(line => line[0] !== '+').map(line => line.slice(1)).join('\n') + '\n';
  const after = records.filter(line => line[0] !== '-').map(line => line.slice(1)).join('\n') + '\n';
  if (reversed.split(after).length !== 2) throw Error('REVERSE_HUNK');
  reversed = reversed.replace(after, before);
}
const reversedSha256 = hash(Buffer.from(reversed));
if (reversedSha256 !== '0c17850b1ceb4f09eec5458315dbb08433aa01721cf1b20fe7385481a20992e1') throw Error('FOREIGN_SOURCE_CHANGED');
const cases = JSON.parse(read(packet + '/future/CASES.json'));
const helperRows = cases.helperControls.filter(row => row.id !== 'H09');
const summary = {
  clock: new Date().toISOString(), mode: 'SOURCE_PREEXEC_ONLY', productionEvaluations: 0, archiveInflations: 0,
  localPins: Object.keys(seal.files).length, inheritedPins: Object.keys(seal.helperPins).length,
  sourceInputs: binding.length, shippingMembers: seal.shipping.length, reversedSha256,
  package: seal.archive, sourceRuntime, sourceHelper,
  counts: { primaryIdentities: cases.rows.length, primaryCalls: cases.rows.length * cases.layouts.length,
    helperIdentities: helperRows.length, helperRowsPerBatch: helperRows.reduce((sum, row) => sum + (row.injectedCheckpointReasons ?? row.injectedReadReasons ?? [null]).length, 0),
    mutantShellCalls: seal.mutations.filter(row => row.caseId !== 'HELPERS').length, runtimeStarts: 1 + 1 + cases.rows.length * cases.layouts.length + 3 + seal.mutations.length + 2 },
  buildEvidence: JSON.parse(read(packet + '/evidence/BUILD-EVIDENCE.json')),
  buildResult: (() => { const result = JSON.parse(read(packet + '/evidence/BUILD-RESULT.json')); return Object.fromEntries(['sourceCommit','started','finished','status','productCalls','workerJobs','consumerChecks','primaryPresent'].map(key => [key, result[key]])); })(),
  buildSealInputs: buildSeal.inputs.length,
};
const contexts = [];
for (const [filename, expression] of [
  [owned + '/pinned-runtime.txt', /private (requireParameter|rethrowArithmeticControl|arithmeticVariables)|requireParameter\(value/],
  ['src/shell/arithmetic.ts', /export function prepareArithmetic|export function evaluateArithmetic|maximum|error token|division by 0/],
  ['src/shell/arrays/ledger.ts', /reserve\(|release\(|snapshot\(/],
]) {
  const text = read(filename).toString().split('\n');
  for (let index = 0; index < text.length; index++) if (expression.test(text[index])) contexts.push({ filename, start: index + 1, text: text.slice(Math.max(0, index - 2), index + 22).map((line, offset) => `${Math.max(0,index-2)+offset+1}: ${line}`).join('\n') });
}
fs.writeFileSync(owned + '/audit.json', JSON.stringify({ summary, admitted, readBytes, findings }, null, 2) + '\n');
fs.writeFileSync(owned + '/source-contexts.json', JSON.stringify(contexts, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  try {
    const request = JSON.parse(line);
    if (request.context !== undefined) console.log(JSON.stringify(contexts.slice(request.context, request.context + (request.count ?? 1)), null, 2));
    else {
      const filename = path.resolve(request.file);
      if (!filename.startsWith(process.cwd() + path.sep) || !/\.(json|md|mjs|ts|txt)$/.test(filename)) throw Error('READ_PATH');
      const bytes = read(filename);
      if (request.keys) { const data = JSON.parse(bytes); console.log(JSON.stringify(Object.fromEntries(request.keys.map(key => [key, data[key]])), null, 2)); }
      else console.log(bytes.toString().split('\n').slice((request.start ?? 1)-1, request.end ?? 60).map((value,index) => `${(request.start ?? 1)+index}: ${value}`).join('\n'));
    }
  } catch (reason) { console.log(JSON.stringify({ error: String(reason) })); }
}
