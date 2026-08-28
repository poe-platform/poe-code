import { readFileSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const own = 'tests/commands/node-worker-independent-20260828/v2/';
const start = performance.now();
let processed = 0;
function read(path) {
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index++) assert(!lstatSync(parts.slice(0, index).join('/')).isSymbolicLink());
  const stat = lstatSync(path);
  assert(stat.isFile() && stat.size < 2 * 1024 * 1024);
  const bytes = readFileSync(path);
  processed += bytes.length;
  assert(processed < 64 * 1024 * 1024 && performance.now() - start < 60000);
  return bytes;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inventories = read(`${own}build-inventory.data`).toString().split('\0');
assert.equal(inventories.pop(), '');
const bindings = [];
const configs = {};
for (const record of inventories) {
  const [header, path] = record.split('\t');
  const [mode, kind, blob] = header.split(' ');
  assert.equal(mode, '100644');
  assert.equal(kind, 'blob');
  assert(['tsconfig.json', 'tsconfig.build.json', 'package.json'].includes(path));
  const bytes = read(`${own}pinned-${path}.data`);
  assert.equal(createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex'), blob);
  bindings.push({ commit: '700651e5ec6f50435a0298845c411a8f2a5a386f', path, blob, bytes: bytes.length, sha256: sha(bytes) });
  configs[path] = JSON.parse(bytes);
}
assert.equal(bindings.length, 3);
assert.equal(configs['tsconfig.json'].compilerOptions.target, 'ES2023');
assert.equal(configs['tsconfig.build.json'].extends, './tsconfig.json');
assert.equal(Object.hasOwn(configs['tsconfig.json'].compilerOptions, 'useDefineForClassFields'), false);
assert.equal(Object.hasOwn(configs['tsconfig.build.json'].compilerOptions, 'useDefineForClassFields'), false);
assert.equal(configs['package.json'].scripts.build, 'tsc -p tsconfig.build.json');
const source = read(`${own}errors-contract.data`).toString();
for (const field of ['syscall', 'path', 'dest']) assert(source.includes(`readonly ${field}?: string;`));
const packet = JSON.parse(read(`${own}packet-readable.data`));
assert(packet['ERRORS.json'].FsErrorDTO.wire.includes('Present undefined/null/nonstring/accessor is not absent'));
const limits = packet['CAPS.json'].limits;
const rawReads = limits.readBytesCumulativeMax;
const responseBytes = 3 * rawReads;
const transferBytes = responseBytes + limits.writeBytesCumulativeMax + limits.outputBytesCumulativeMax;
const chunkBound = Math.ceil(transferBytes / 65536) + limits.operationSequenceMax;
const validPublishedFrameBound = 3 * limits.operationSequenceMax + 2 * chunkBound;
assert.equal(validPublishedFrameBound, 1184);
assert(validPublishedFrameBound < limits.framesAllDirectionsMax);
const rows = packet['RPC.json'].transitions;
assert.equal(rows.length, 14);
const directZeroFinalEdge = rows.some(row => row.from === 'WORKER_OWNED' && row.to === 'ACK/FINAL_ACK');
assert.equal(directZeroFinalEdge, false);
const result = {
  role: 'DATA/source-profile inference and arithmetic only; no compiler or protocol execution',
  bindings,
  errorFieldInference: {
    optionalDeclarations: ['syscall', 'path', 'dest'], target: 'ES2023', overrideAbsent: true,
    v2RejectsOwnUndefined: true, runtimeObjectObserved: false,
    consequence: 'Standard field initialization makes unspecified optional class fields own undefined; v2 extraction rejects that legitimate typed-source representation. Primary TS semantics, not a constructed/runtime observation.',
  },
  traffic: {
    rawReadCap: rawReads, encodedReadUpperBound: responseBytes, transferBytes,
    chunkBound, validPublishedFrameBound, globalFrameCap: limits.framesAllDirectionsMax,
    qualification: 'Conservative valid-traffic bound; no new budget, retries or runtime frame measurement. Unpublished reservations still burn quota; malformed traffic fails closed.',
  },
  transitionRows: 14, directZeroFinalEdge,
  qualification: 'Prose requires zero-result FINAL_ACK; the explicit transition row is missing, not proof the abstract design intends to reject it.',
  processedBytes: processed, elapsedMs: performance.now() - start,
};
writeFileSync(`${own}SUPPLEMENT-RESULT.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
