import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const run = path.resolve(directory, '../executor-v6/runs/admission-v6-01');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const config = JSON.parse(fs.readFileSync(path.join(run, 'child-003.json')));
const receipt = JSON.parse(fs.readFileSync(path.join(run, 'child-003.receipt.json')));
assert.equal(hash(fs.readFileSync(path.join(run, 'child-003.receipt.json'))), '78bbe43ff593aebc98e603b69c14ac0fc51e330a1863d95761aa90285a1d0dd6');
const sources = [];
for (const load of receipt.records.filter(row => row.kind === 'nextLoad')) {
  const entry = config.view.files.find(row => row.path === load.path);
  assert.ok(entry && !entry.path.toLowerCase().includes('agents.md'));
  const filename = path.join(config.view.root, entry.path);
  const info = fs.lstatSync(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  assert.equal(info.size, entry.bytes);
  assert.equal(info.mode & 0o7777, entry.mode);
  const bytes = fs.readFileSync(filename);
  assert.equal(hash(bytes), entry.sha256);
  const text = bytes.toString('utf8');
  const tokens = entry.path.endsWith('/bundle/index.js') ? ['getBuiltinModule', '\\bMf\\b', '\\bKs\\b'] : ['getBuiltinModule'];
  const observations = tokens.map(token => ({ token, matches: [...text.matchAll(new RegExp(token, 'g'))].map(match => ({ byteOffset: Buffer.byteLength(text.slice(0, match.index)), line: text.slice(0, match.index).split('\n').length, excerpt: text.slice(Math.max(0, match.index - 160), match.index + 450) })) }));
  sources.push({ ...entry, authenticatedBeforeAndAfter: true, observations });
  assert.equal(hash(fs.readFileSync(filename)), entry.sha256);
}
const artifactNames = fs.readdirSync(run).filter(name => fs.lstatSync(path.join(run, name)).isFile());
const artifacts = artifactNames.map(name => { const bytes = fs.readFileSync(path.join(run, name)); return { name, bytes: bytes.length, sha256: hash(bytes), exceeds262144: bytes.length > 262144 }; });
const result = { kind: 'SOURCE_AND_RETAINED_ARTIFACT_ONLY', executedEngines: 0, deniedApiCalls: 0, moduleInitialization: 0, sources, artifacts, artifactBytes: artifacts.reduce((sum, row) => sum + row.bytes, 0), rawStdout: { observed: 359581, retainedPrefix: 65536, irrecoverableUnretained: 294045, reconstructed: false }, qualifications: ['Only the 21 previously witnessed startup sources were read, not all deferred command chunks.', 'Substring/identifier inventory is static evidence, not an executed semantic proof.', 'Raw child FD3 channels obeyed their cumulative 262144-byte caps; persisted JSON artifacts did not all obey that same size ceiling.'] };
fs.writeFileSync(path.join(directory, 'OBSERVATIONS.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ sources: sources.length, overCap: artifacts.filter(row => row.exceeds262144), artifactBytes: result.artifactBytes, engineExecutions: 0 }));
