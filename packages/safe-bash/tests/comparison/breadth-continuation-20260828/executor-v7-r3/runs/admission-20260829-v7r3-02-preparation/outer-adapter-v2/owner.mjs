import fs from 'node:fs/promises';
import { createReadStream, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { captureLaunch, LIMITS, reasonRecord, publishTerminal } from './capture.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const executor = path.resolve(home, '../../..');
const repository = path.resolve(executor, '../../../..');
const runId = 'admission-20260829-v7r3-02';
const authPath = path.resolve(home, '../activation/AUTH.json');
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const recipeSha256 = 'bd4690d595751b99b3a2bf020f0063f86c03b23ae2600ecaa637be7dc6096b1c';
const interfaceSha256 = 'f6c3965ad7b31747dad30b3357de8813a28b3c18963a39ad04582358e3f55c18';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const own = (value, keys) => {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'OUTER_SCHEMA_OBJECT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key) && 'value' in descriptors[key]), 'OUTER_SCHEMA_KEYS');
};
const hashFile = async expected => {
  const stat = await fs.lstat(expected.path);
  requireThat(stat.isFile() && stat.size === expected.bytes && (stat.mode & 511) === expected.mode, 'OUTER_FILE_METADATA');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(expected.path, { highWaterMark: 65536 })) hash.update(bytes);
  requireThat(hash.digest('hex') === expected.sha256, 'OUTER_FILE_HASH');
};
const bounded = async (file, cap) => {
  const stat = await fs.lstat(file);
  requireThat(stat.isFile() && stat.size <= cap && (stat.mode & 511) === 420, 'OUTER_METADATA_FILE');
  return fs.readFile(file);
};
const [suppliedAuth, suppliedAuthSha, suppliedSealSha] = process.argv.slice(2);
let seal;
const guard = async () => {
  requireThat(process.argv.length === 5 && suppliedAuth === authPath && /^[0-9a-f]{64}$/.test(suppliedAuthSha ?? '') && /^[0-9a-f]{64}$/.test(suppliedSealSha ?? ''), 'OUTER_ARGUMENTS');
  requireThat(process.execPath === node && JSON.stringify(process.execArgv) === JSON.stringify(['--unhandled-rejections=strict', '--max-old-space-size=256']), 'OUTER_NODE_ARGUMENTS');
  const bytes = await bounded(path.join(home, 'SEAL.json'), 65536);
  requireThat(sha(bytes) === suppliedSealSha, 'OUTER_SEAL_HASH');
  seal = JSON.parse(bytes);
  own(seal, ['schema', 'date', 'files', 'node', 'bindings', 'controls', 'actualAuthorized']);
  requireThat(seal.schema === 'V7_R3_OUTER_PREEXECUTION_SEAL_V1' && seal.actualAuthorized === false && Array.isArray(seal.files) && seal.files.length === 7, 'OUTER_SEAL_SCHEMA');
  const expectedNames = ['capture.mjs', 'owner.mjs', 'controls.mjs', 'stub.mjs', 'CONTROL-PLAN.json', 'INACTIVE-GRANT-METADATA.json', 'README.md'];
  for (const [index, entry] of seal.files.entries()) {
    own(entry, ['path', 'bytes', 'mode', 'sha256']);
    requireThat(entry.path === expectedNames[index] && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.mode === 420 && /^[0-9a-f]{64}$/.test(entry.sha256), 'OUTER_SOURCE_ROW');
    await hashFile({ ...entry, path: path.join(home, entry.path) });
  }
  own(seal.node, ['path', 'bytes', 'mode', 'sha256']);
  requireThat(seal.node.path === node && seal.node.bytes === 112989184 && seal.node.mode === 493 && seal.node.sha256 === '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011', 'OUTER_TOOL_ID');
  await hashFile(seal.node);
  own(seal.bindings, ['recipeSha256', 'interfaceSha256', 'launch']);
  requireThat(seal.bindings.recipeSha256 === recipeSha256 && seal.bindings.interfaceSha256 === interfaceSha256, 'OUTER_BINDINGS');
  own(seal.bindings.launch, ['path', 'bytes', 'mode', 'sha256']);
  requireThat(seal.bindings.launch.path === path.join(executor, 'launch.mjs') && seal.bindings.launch.bytes === 2584 && seal.bindings.launch.mode === 420 && seal.bindings.launch.sha256 === '928900c9e495763a45ac2a9860aec6b3d3d82a679ea9649eb72a2c1481bf20ed', 'OUTER_LAUNCH_BINDING');
  await hashFile(seal.bindings.launch);
  const authBytes = await bounded(authPath, 65536);
  requireThat(sha(authBytes) === suppliedAuthSha, 'OUTER_AUTH_HASH');
  const auth = JSON.parse(authBytes);
  own(auth, ['review', 'grant']);
  for (const role of ['review', 'grant']) {
    own(auth[role], ['commit', 'path', 'sha256']);
    requireThat(typeof auth[role].commit === 'string' && /^[0-9a-f]{40}$/.test(auth[role].commit) && typeof auth[role].path === 'string' && typeof auth[role].sha256 === 'string' && /^[0-9a-f]{64}$/.test(auth[role].sha256), 'OUTER_AUTH_REFERENCE');
  }
  requireThat(auth.review.commit === 'd27fd9145ef27fa1f03e273fe0d4954e7680b147' && auth.review.path === 'tests/comparison/v7-r3-independent-20260829/review-v2/REVIEW-RECEIPT.json' && auth.review.sha256 === '203947e58e56c6249fc93485bb5c925a1549bafea19104c034658d71a2e7c293', 'OUTER_REVIEW');
  requireThat(auth.grant.path === path.relative(repository, path.resolve(home, '../activation/ROOT-GRANT.json')), 'OUTER_GRANT_PATH');
};
const directory = path.join(home, 'actual-capture');
const started = Date.now();
const result = await captureLaunch({ directory, runId, totalMs: 4500000, termMs: 2000, killMs: 1000, command: { file: node, args: ['--unhandled-rejections=strict', '--max-old-space-size=256', path.join(executor, 'launch.mjs'), 'admission', runId, suppliedAuth, suppliedAuthSha], cwd: repository, env: { PATH: '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', HOME: home, TMPDIR: home } } }, { beforeLaunch: guard });
let postflight = false;
let postflightFailure = null;
try { if (result.qualified) { await guard(); requireThat(Date.now() - started <= 4500000, 'OUTER_TOTAL_DEADLINE'); postflight = true; } }
catch (error) { postflightFailure = reasonRecord(error); }
const terminal = { schema: 'BREADTH_OUTER_TERMINAL_V1', captureQualified: result.qualified && postflight, admissionQualified: null, primaryPresent: result.primaryPresent, primary: result.receipt.primary, publicationPresent: result.publicationPresent, postflight, postflightFailure, child: result.receipt.child, streams: result.receipt.streams, adapterSealSha256: suppliedSealSha ?? null, receipt: null, limits: LIMITS, qualification: 'Outer capture only; full inner admission disposition and integrity remain independently required' };
if (!result.publicationPresent) {
  try { const bytes = await fs.readFile(path.join(directory, 'RECEIPT.json')); requireThat(bytes.length <= LIMITS.receipt, 'OUTER_RECEIPT_BOUND'); terminal.receipt = { path: path.join(directory, 'RECEIPT.json'), bytes: bytes.length, sha256: sha(bytes) }; }
  catch (error) { terminal.captureQualified = false; terminal.receiptFailure = reasonRecord(error); }
}
process.exitCode = terminal.captureQualified ? 0 : 1;
const publication = publishTerminal(terminal, (bytes, offset, length) => writeSync(1, bytes, offset, length));
if (!publication.ok) process.exitCode = 1;
